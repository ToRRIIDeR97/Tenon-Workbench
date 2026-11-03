import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"

// Supervises the tenon-dictation engine (tenon/packages/dictation) over its JSON-lines stdio
// protocol. The engine is spawned on the first start, respawned on the next start after it exits
// (like superviseSidecar, with a restart limit), and loads the active model on every spawn.

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
  | { type: "final"; id: string; text: string }
  | { type: "error"; id?: string; code: string; message: string }

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

export function createDictation(input: {
  command: string
  args?: string[]
  log: (message: string, meta?: Record<string, unknown>) => void
  /** The model file to load after each spawn; undefined starts the engine without one. */
  model?: () => string | undefined
  /** How long a model load may take before the engine is treated as hung; tests shorten it. */
  loadTimeout?: number
}) {
  const levels = new Set<(rms: number) => void>()
  const failures = new Set<(error: DictationError) => void>()
  const pending = new Map<string, Pending>()
  let engine: Engine | undefined
  let status: DictationStatus = "idle"
  let startID: string | undefined
  // An error the engine reported for the current recording (mic denied, engine exit); stop() rejects with it.
  let recordingError: DictationError | undefined
  let nextID = 0
  let crashes: number[] = []
  let readyWaiter: { resolve: () => void; reject: (error: DictationError) => void } | undefined

  const id = () => String(++nextID)
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
      // The recording never began (no microphone, access denied): the next stop() reports why.
      recordingError = error
      status = "idle"
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
    // stderr carries native diagnostics; it is drained, not logged, so no audio-derived text reaches the log.
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

  // An engine that never got ready or never finished a load is killed and forgotten, so the next start
  // spawns a fresh one instead of reusing it (or answering already_recording) forever. It counts as a crash.
  const discard = (current: Engine) => {
    if (current.exited) return
    current.exited = true
    if (engine === current) engine = undefined
    readyWaiter = undefined
    crashes = [...crashes.filter((at) => Date.now() - at < RESTART_WINDOW), Date.now()]
    input.log("dictation engine timed out")
    current.child.kill()
  }

  // `ready` answers a load; an error carrying the request id rejects it. No answer in time rejects it too.
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
    async start() {
      if (status !== "idle") throw new DictationError("already_recording", "Dictation is already running")
      status = "starting"
      recordingError = undefined
      const current = await ensureEngine().catch((error: unknown) => {
        status = "idle"
        throw error
      })
      startID = id()
      status = "recording"
      send(current, { id: startID, type: "start" })
    },
    stop() {
      const error = recordingError
      recordingError = undefined
      if (error) {
        // A microphone that failed mid-recording leaves the engine's recorder open; release it.
        if (engine && status === "recording") send(engine, { id: id(), type: "cancel" })
        status = "idle"
        return Promise.reject(error)
      }
      const current = engine
      if (status !== "recording" || !current)
        return Promise.reject(new DictationError("not_recording", "Dictation is not recording"))
      status = "transcribing"
      const request = id()
      return new Promise<string>((resolve, reject) => {
        pending.set(request, { resolve, reject })
        send(current, { id: request, type: "stop" })
      }).finally(() => {
        if (status === "transcribing") status = "idle"
      })
    },
    cancel() {
      recordingError = undefined
      if (engine && (status === "recording" || status === "starting")) send(engine, { id: id(), type: "cancel" })
      if (status !== "transcribing") status = "idle"
    },
    /** Loads `model` into a running engine now; a stopped engine loads it on its next spawn. */
    async reload() {
      const model = input.model?.()
      const current = engine
      if (!current || current.exited || !model || status !== "idle") return
      await load(current, model).catch((error: unknown) => {
        if (error instanceof DictationError && error.code === "engine_unavailable") discard(current)
        throw error
      })
    },
    status: () => status,
    onLevel(listener: (rms: number) => void) {
      levels.add(listener)
      return () => void levels.delete(listener)
    },
    onError(listener: (error: DictationError) => void) {
      failures.add(listener)
      return () => void failures.delete(listener)
    },
    dispose() {
      const current = engine
      engine = undefined
      if (current && !current.exited) current.child.kill()
    },
  }
}

export type Dictation = ReturnType<typeof createDictation>

export type MicrophoneAccess = "granted" | "denied" | "restricted" | "not-determined" | "unknown"

/** Where to send someone whose microphone access is off, per platform; undefined when nothing is needed. */
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
