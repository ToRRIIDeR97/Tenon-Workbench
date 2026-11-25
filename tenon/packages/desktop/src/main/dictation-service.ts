import { tmpdir } from "node:os"
import { wavBytes } from "./wav"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app, net, shell, systemPreferences } from "electron"
import { createDictation, dictationPermissionHelp, DictationError, type MicrophoneAccess } from "./dictation"
import { downloadModel, DictationDownloadError, type DictationDownloadCode } from "./dictation-download"
import { DICTATION_MODELS, dictationEngineFile, type DictationModelID } from "./dictation-models"
import { write as writeLog } from "./logging"

export type DictationFailure = { code: string; help?: { key: string; url: string } }
export type DictationModelState = {
  folder: string
  active?: DictationModelID
  models: { id: DictationModelID; name: string; size: number; downloaded: boolean }[]
}
export type DictationDownloadProgress = { id: DictationModelID; received: number; total: number }
export type DictationDownloadResult = { error?: DictationDownloadCode }

export function createDictationService() {
  const folder = join(app.getPath("userData"), "dictation", "models")
  const settingsFile = join(app.getPath("userData"), "dictation", "settings.json")
  const engine = engineCommand()
  const downloads = new Map<DictationModelID, { task: Promise<DictationDownloadResult>; controller: AbortController }>()
  let active: DictationModelID | undefined
  let levelTarget: ((rms: number) => void) | undefined
  let limitTarget: (() => void) | undefined
  let partialTarget: ((text: string) => void) | undefined
  let bandsTarget: ((values: number[]) => void) | undefined

  const modelPath = (id: DictationModelID) => join(folder, modelFile(id))
  const activePath = () => (active && existsSync(modelPath(active)) ? modelPath(active) : undefined)
  const dictation = createDictation({
    command: engine,
    log: (message, meta) => writeLog("dictation", message, meta),
    model: activePath,
  })
  dictation.onLevel((rms) => levelTarget?.(rms))
  dictation.onPartial((text) => partialTarget?.(text))
  dictation.onBands((values) => bandsTarget?.(values))
  dictation.onLimit(() => limitTarget?.())
  app.once("will-quit", () => dictation.dispose())

  const ready = readFile(settingsFile, "utf8")
    .then((text) => {
      const value: unknown = JSON.parse(text)
      const id = (value as { active?: unknown }).active
      if (isModelID(id)) active = id
    })
    .catch(() => undefined)

  const failure = (error: unknown): DictationFailure => {
    const code = error instanceof DictationError ? error.code : "engine_unavailable"
    if (code !== "permission_denied") return { code }
    return { code, help: dictationPermissionHelp(process.platform, "denied") }
  }

  const service = {
    async transcribe(samples: Float32Array): Promise<{ text?: string; error?: DictationFailure }> {
      await ready
      if (!existsSync(engine)) return { error: { code: "engine_unavailable" } }
      if (!activePath()) return { error: { code: "no_model" } }
      const file = join(tmpdir(), `tenon-attachment-${process.pid}-${Date.now()}.wav`)
      await writeFile(file, wavBytes(samples, 16_000))
      return dictation
        .transcribeFile(file)
        .then(
          (text) => ({ text }),
          (error: unknown) => ({ error: failure(error) }),
        )
        .finally(() => void unlink(file).catch(() => undefined))
    },
    async start(
      onLevel: (rms: number) => void,
      onLimit: () => void,
      onPartial?: (text: string) => void,
      options: { language?: string } = {},
      onBands?: (values: number[]) => void,
    ): Promise<{ error?: DictationFailure }> {
      await ready
      if (!existsSync(engine)) return { error: { code: "engine_unavailable" } }
      if (!activePath()) return { error: { code: "no_model" } }
      const access = await microphoneAccess()
      const help = dictationPermissionHelp(process.platform, access)
      if (help) return { error: { code: "permission_denied", help } }
      if (dictation.status() === "transcribing") return { error: { code: "transcribing" } }
      if (dictation.status() !== "idle") return { error: { code: "already_recording" } }
      levelTarget = onLevel
      limitTarget = onLimit
      partialTarget = onPartial
      bandsTarget = onBands
      return dictation.start({ language: dictationLanguageCode(options.language) }).then(
        () => ({}),
        (error: unknown) => ({ error: failure(error) }),
      )
    },
    async stop(): Promise<{ text?: string; error?: DictationFailure }> {
      levelTarget = undefined
      partialTarget = undefined
      bandsTarget = undefined
      return dictation.stop().then(
        (text) => ({ text }),
        (error: unknown) => ({ error: failure(error) }),
      )
    },
    cancel() {
      levelTarget = undefined
      partialTarget = undefined
      bandsTarget = undefined
      dictation.cancel()
    },
    async models(): Promise<DictationModelState> {
      await ready
      return {
        folder,
        active,
        models: DICTATION_MODELS.map((model) => ({
          id: model.id,
          name: model.name,
          size: model.size,
          downloaded: existsSync(modelPath(model.id)),
        })),
      }
    },
    async setActive(id: unknown) {
      if (!isModelID(id)) throw new Error("Unknown dictation model")
      await ready
      active = id
      await mkdir(join(settingsFile, ".."), { recursive: true })
      await writeFile(settingsFile, JSON.stringify({ active }))
      await dictation.reload().catch((error: unknown) =>
        writeLog("dictation", "model reload failed", {
          code: error instanceof DictationError ? error.code : "unknown",
        }),
      )
    },
    download(id: unknown, onProgress: (progress: DictationDownloadProgress) => void) {
      if (!isModelID(id)) return Promise.reject(new Error("Unknown dictation model"))
      const running = downloads.get(id)
      if (running) return running.task
      const model = DICTATION_MODELS.find((entry) => entry.id === id)!
      const controller = new AbortController()
      const task = downloadModel({
        model,
        target: modelPath(id),
        fetch: (url, init) => net.fetch(url, init),
        signal: controller.signal,
        onProgress: (received) => onProgress({ id, received, total: model.size }),
      })
        .finally(() => downloads.delete(id))
        .then(
          async (): Promise<DictationDownloadResult> => {
            await ready
            if (!active || !existsSync(modelPath(active))) await service.setActive(id)
            return {}
          },
          (error: unknown) => {
            if (error instanceof DictationDownloadError) return { error: error.code }
            throw error
          },
        )
      downloads.set(id, { task, controller })
      return task
    },
    cancelDownload(id: unknown) {
      if (!isModelID(id)) throw new Error("Unknown dictation model")
      downloads.get(id)?.controller.abort()
    },
    async remove(id: unknown) {
      if (!isModelID(id)) throw new Error("Unknown dictation model")
      await rm(modelPath(id), { force: true })
    },
    openPermissionSettings() {
      const help = dictationPermissionHelp(process.platform, "denied")
      if (help) void shell.openExternal(help.url)
    },
  }
  return service
}

export type DictationService = ReturnType<typeof createDictationService>

async function microphoneAccess(): Promise<MicrophoneAccess> {
  if (process.platform !== "darwin" && process.platform !== "win32") return "granted"
  const status = systemPreferences.getMediaAccessStatus("microphone")
  if (process.platform === "darwin" && status === "not-determined")
    return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied"
  return status
}

function engineCommand() {
  const override = process.env.TENON_DICTATION_ENGINE
  if (override) return override
  const file = dictationEngineFile(process.platform)
  if (app.isPackaged) return join(process.resourcesPath, "dictation", file)
  return join(app.getAppPath(), "..", "dictation", "target", "release", file)
}

function modelFile(id: DictationModelID) {
  return DICTATION_MODELS.find((model) => model.id === id)!.file
}

export function dictationLanguageCode(value: unknown) {
  if (typeof value !== "string") return undefined
  const code = value.trim().toLowerCase()
  return /^[a-z]{2,3}$/.test(code) ? code : undefined
}

function isModelID(value: unknown): value is DictationModelID {
  return DICTATION_MODELS.some((model) => model.id === value)
}
