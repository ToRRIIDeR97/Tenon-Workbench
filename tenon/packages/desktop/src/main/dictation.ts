import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"

export type DictationStatus = "idle" | "starting" | "recording" | "transcribing"
export type DictationErrorCode =
  | "engine_exited"
  | "engine_unavailable"
  | "not_recording"
  | "already_recording"
  | "no_model"
  | "permission_denied"
  | (string & {})

export class DictationError extends Error {
  constructor(
    readonly code: DictationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DictationError"
  }
}

type EngineEvent =
  | { type: "ready" }
  | { type: "level"; rms: number }
  | { type: "bands"; values: unknown }
  | { type: "partial"; text: string }
  | { type: "final"; id: string; text: string }
  | { type: "error"; id?: string; code: string; message: string }

export function dictationBands(event: unknown) {
  if (typeof event !== "object" || event === null) return undefined
  const record = event as { type?: unknown; values?: unknown }
  if (record.type !== "bands" || !Array.isArray(record.values) || record.values.length > 64) return undefined
  if (!record.values.every((value) => typeof value === "number" && Number.isFinite(value))) return undefined
  return (record.values as number[]).map((value) => Math.min(1, Math.max(0, value)))
}

type Engine = {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  exited: boolean
}

type Pending = { resolve: (text: string) => void; reject: (error: DictationError) => void }

const READY_TIMEOUT = 20_000
const LOAD_TIMEOUT = 60_000
const MAX_RESTARTS = 5
const RESTART_WINDOW = 10 * 60_000
const MAX_RECORDING = 30 * 60_000
const TRANSCRIBE_TIMEOUT = 2 * 60_000
const TRANSCRIBE_TIMEOUT_FACTOR = 10
const IDLE_TIMEOUT = 10 * 60_000

export function createDictation(input: {
  command: string
  args?: string[]
  log: (message: string, meta?: Record<string, unknown>) => void
  model?: () => string | undefined
  loadTimeout?: number
  transcribeTimeout?: number
  maxRecording?: number
  idleTimeout?: number
}) {
  const levels = new Set<(rms: number) => void>()
  const partials = new Set<(text: string) => void>()
  const bandListeners = new Set<(values: number[]) => void>()
  const limits = new Set<() => void>()
  const failures = new Set<(error: DictationError) => void>()
  const pending = new Map<string, Pending>()
  let engine: Engine | undefined
  let status: DictationStatus = "idle"
  let startID: string | undefined
  let recordingError: DictationError | undefined
  let nextID = 0
  let crashes: number[] = []
  let readyWaiter: { resolve: () => void; reject: (error: DictationError) => void } | undefined
  let recordingStarted = 0
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let limited: Promise<string> | undefined

  const id = () => String(++nextID)
  const armIdle = () => {
    clearTimeout(idleTimer)
    if (!engine || status !== "idle") return
    idleTimer = setTimeout(() => {
      if (engine && status === "idle") discard(engine, false)
    }, input.idleTimeout ?? IDLE_TIMEOUT)
    idleTimer.unref?.()
  }
  const send = (current: Engine, request: Record<string, unknown>) => {
    if (current.exited || !current.child.stdin.writable) return
    current.child.stdin.write(JSON.stringify(request) + "\n")
  }

  const fail = (error: DictationError) => {
    if (status === "recording" || status === "starting") recordingError = error
    failures.forEach((listener) => listener(error))
  }

  const onEvent = (event: EngineEvent) => {
    if (event.type === "ready") {
      readyWaiter?.resolve()
      readyWaiter = undefined
      return
    }
    if (event.type === "level") {
      if (status === "recording" && typeof event.rms === "number") levels.forEach((listener) => listener(event.rms))
      return
    }
    if (event.type === "bands") {
      const values = dictationBands(event)
      if (status === "recording" && values) bandListeners.forEach((listener) => listener(values))
      return
    }
    if (event.type === "partial") {
      if (status === "recording" && typeof event.text === "string") partials.forEach((listener) => listener(event.text))
      return
    }
    if (event.type === "final") {
      const waiter = pending.get(event.id)
      pending.delete(event.id)
      waiter?.resolve(typeof event.text === "string" ? event.text : "")
      return
    }
    if (event.type !== "error") return
    const error = new DictationError(event.code, event.message)
    const waiter = event.id ? pending.get(event.id) : undefined
    if (waiter) {
      pending.delete(event.id!)
      return waiter.reject(error)
    }
    input.log("dictation engine error", { code: event.code })
    if (event.id && event.id === startID && status === "recording") {
      recordingError = error
      status = "idle"
      clearTimeout(limitTimer)
      armIdle()
      return failures.forEach((listener) => listener(error))
    }
    fail(error)
  }

  const spawnEngine = () => {
    const child = spawn(input.command, input.args ?? [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    const current: Engine = { child, exited: false, ready: Promise.resolve() }
    current.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new DictationError("engine_unavailable", "The dictation engine did not start")),
        READY_TIMEOUT,
      )
      readyWaiter = {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
    })
    createInterface({ input: child.stdout }).on("line", (line) => {
      const event = parseEvent(line)
      if (event) onEvent(event)
    })
    child.stderr.resume()
    child.stdin.on("error", () => {})
    child.on("error", (error) => {
      input.log("dictation engine failed to start", { error: error.message })
      onExit(current, null)
    })
    child.on("exit", (code) => onExit(current, code))
    return current
  }

  const onExit = (current: Engine, code: number | null) => {
    if (current.exited) return
    current.exited = true
    if (engine === current) engine = undefined
    clearTimeout(limitTimer)
    const error = new DictationError("engine_exited", "The dictation engine stopped")
    input.log("dictation engine exited", { code })
    readyWaiter?.reject(error)
    readyWaiter = undefined
    pending.forEach((waiter) => waiter.reject(error))
    pending.clear()
    if (status === "recording" || status === "starting") {
      crashes = [...crashes.filter((at) => Date.now() - at < RESTART_WINDOW), Date.now()]
      fail(error)
    }
    status = "idle"
  }

  const ensureEngine = async () => {
    if (engine && !engine.exited) return engine
    if (crashes.filter((at) => Date.now() - at < RESTART_WINDOW).length >= MAX_RESTARTS)
      throw new DictationError("engine_unavailable", "The dictation engine keeps stopping")
    const current = spawnEngine()
    engine = current
    try {
      await current.ready
      const model = input.model?.()
      if (model) await load(current, model)
    } catch (error) {
      if (error instanceof DictationError && error.code === "engine_unavailable") discard(current)
      throw error
    }
    return current
  }

  const discard = (current: Engine, crash = true) => {
    if (current.exited) return
    current.exited = true
    if (engine === current) engine = undefined
    readyWaiter = undefined
    if (crash) crashes = [...crashes.filter((at) => Date.now() - at < RESTART_WINDOW), Date.now()]
    input.log(crash ? "dictation engine timed out" : "dictation engine stopped")
    current.child.kill()
  }

  const abandon = (current: Engine, error: DictationError, crash: boolean) => {
    discard(current, crash)
    pending.forEach((waiter) => waiter.reject(error))
    pending.clear()
    status = "idle"
  }

  const transcribe = (current: Engine) => {
    clearTimeout(limitTimer)
    status = "transcribing"
    const request = id()
    const timer = setTimeout(
      () => abandon(current, new DictationError("transcribe_timeout", "The transcription took too long"), true),
      (input.transcribeTimeout ?? TRANSCRIBE_TIMEOUT) + (Date.now() - recordingStarted) * TRANSCRIBE_TIMEOUT_FACTOR,
    )
    return new Promise<string>((resolve, reject) => {
      pending.set(request, { resolve, reject })
      send(current, { id: request, type: "stop" })
    }).finally(() => {
      clearTimeout(timer)
      if (status === "transcribing") status = "idle"
      armIdle()
    })
  }

  const transcribeFile = async (path: string, language?: string) => {
    if (status !== "idle")
      throw new DictationError(status === "transcribing" ? "transcribing" : "already_recording", "Dictation is busy")
    const current = await ensureEngine()
    status = "transcribing"
    const request = id()
    const timer = setTimeout(
      () => abandon(current, new DictationError("transcribe_timeout", "The transcription took too long"), true),
      5 * 60_000,
    )
    return new Promise<string>((resolve, reject) => {
      pending.set(request, { resolve, reject })
      send(current, { id: request, type: "transcribe_file", path, ...(language ? { language } : {}) })
    }).finally(() => {
      clearTimeout(timer)
      if (status === "transcribing") status = "idle"
      armIdle()
    })
  }

  const load = (current: Engine, model: string) =>
    new Promise<void>((resolve, reject) => {
      const request = id()
      const timer = setTimeout(
        () => settle(new DictationError("engine_unavailable", "The dictation model did not load")),
        input.loadTimeout ?? LOAD_TIMEOUT,
      )
      const settle = (error?: DictationError) => {
        clearTimeout(timer)
        pending.delete(request)
        readyWaiter = undefined
        if (error) return reject(error)
        resolve()
      }
      readyWaiter = { resolve: () => settle(), reject: settle }
      pending.set(request, { resolve: () => settle(), reject: settle })
      send(current, { id: request, type: "load", model })
    })

  return {
    async start(options: { language?: string } = {}) {
      if (status !== "idle") throw new DictationError("already_recording", "Dictation is already running")
      status = "starting"
      recordingError = undefined
      limited = undefined
      clearTimeout(idleTimer)
      const current = await ensureEngine().catch((error: unknown) => {
        status = "idle"
        armIdle()
        throw error
      })
      startID = id()
      status = "recording"
      recordingStarted = Date.now()
      send(current, { id: startID, type: "start", ...(options.language ? { language: options.language } : {}) })
      limitTimer = setTimeout(() => {
        if (status !== "recording" || recordingError) return
        const transcript = transcribe(current)
        transcript.catch(() => undefined)
        limited = transcript
        limits.forEach((listener) => listener())
      }, input.maxRecording ?? MAX_RECORDING)
      limitTimer.unref?.()
    },
    stop() {
      if (limited) {
        const transcript = limited
        limited = undefined
        return transcript
      }
      const error = recordingError
      recordingError = undefined
      if (error) {
        if (engine && status === "recording") send(engine, { id: id(), type: "cancel" })
        clearTimeout(limitTimer)
        status = "idle"
        armIdle()
        return Promise.reject(error)
      }
      const current = engine
      if (status !== "recording" || !current)
        return Promise.reject(new DictationError("not_recording", "Dictation is not recording"))
      return transcribe(current)
    },
    cancel() {
      recordingError = undefined
      limited = undefined
      clearTimeout(limitTimer)
      if (status === "transcribing") {
        if (engine) abandon(engine, new DictationError("cancelled", "Dictation was cancelled"), false)
        return
      }
      if (engine && (status === "recording" || status === "starting")) send(engine, { id: id(), type: "cancel" })
      status = "idle"
      armIdle()
    },
    async reload() {
      const model = input.model?.()
      const current = engine
      if (!current || current.exited || !model || status !== "idle") return
      clearTimeout(idleTimer)
      await load(current, model)
        .catch((error: unknown) => {
          if (error instanceof DictationError && error.code === "engine_unavailable") discard(current)
          throw error
        })
        .finally(armIdle)
    },
    status: () => status,
    transcribeFile,
    onLevel(listener: (rms: number) => void) {
      levels.add(listener)
      return () => void levels.delete(listener)
    },
    onBands(listener: (values: number[]) => void) {
      bandListeners.add(listener)
      return () => void bandListeners.delete(listener)
    },
    onPartial(listener: (text: string) => void) {
      partials.add(listener)
      return () => void partials.delete(listener)
    },
    onLimit(listener: () => void) {
      limits.add(listener)
      return () => void limits.delete(listener)
    },
    onError(listener: (error: DictationError) => void) {
      failures.add(listener)
      return () => void failures.delete(listener)
    },
    dispose() {
      clearTimeout(limitTimer)
      clearTimeout(idleTimer)
      const current = engine
      engine = undefined
      if (current && !current.exited) current.child.kill()
    },
  }
}

export type Dictation = ReturnType<typeof createDictation>

export type MicrophoneAccess = "granted" | "denied" | "restricted" | "not-determined" | "unknown"

export function dictationPermissionHelp(platform: NodeJS.Platform, state: MicrophoneAccess) {
  if (state !== "denied" && state !== "restricted") return undefined
  if (platform === "darwin")
    return {
      key: "dictation.permission.macos",
      url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    } as const
  if (platform === "win32")
    return { key: "dictation.permission.windows", url: "ms-settings:privacy-microphone" } as const
  return undefined
}

function parseEvent(line: string): EngineEvent | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string")
      return value as EngineEvent
  } catch {}
  return undefined
}
