import { createHash } from "node:crypto"
import { createWriteStream, existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { app, shell, systemPreferences } from "electron"
import { createDictation, dictationPermissionHelp, DictationError, type MicrophoneAccess } from "./dictation"
import { DICTATION_MODELS, dictationEngineFile, dictationModelURL, type DictationModelID } from "./dictation-models"
import { write as writeLog } from "./logging"

export type DictationFailure = { code: string; help?: { key: string; url: string } }
export type DictationModelState = {
  folder: string
  active?: DictationModelID
  models: { id: DictationModelID; name: string; size: number; downloaded: boolean }[]
}
export type DictationDownloadProgress = { id: DictationModelID; received: number; total: number }

/**
 * The desktop dictation feature: model files under the app data folder, the active model choice,
 * microphone permission per platform, and the supervised tenon-dictation engine.
 */
export function createDictationService() {
  const folder = join(app.getPath("userData"), "dictation", "models")
  const settingsFile = join(app.getPath("userData"), "dictation", "settings.json")
  const engine = engineCommand()
  const downloads = new Map<DictationModelID, Promise<void>>()
  let active: DictationModelID | undefined
  let levelTarget: ((rms: number) => void) | undefined

  const modelPath = (id: DictationModelID) => join(folder, modelFile(id))
  const activePath = () => (active && existsSync(modelPath(active)) ? modelPath(active) : undefined)
  const dictation = createDictation({
    command: engine,
    log: (message, meta) => writeLog("dictation", message, meta),
    model: activePath,
  })
  dictation.onLevel((rms) => levelTarget?.(rms))
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
    async start(onLevel: (rms: number) => void): Promise<{ error?: DictationFailure }> {
      await ready
      if (!existsSync(engine)) return { error: { code: "engine_unavailable" } }
      if (!activePath()) return { error: { code: "no_model" } }
      const access = await microphoneAccess()
      const help = dictationPermissionHelp(process.platform, access)
      if (help) return { error: { code: "permission_denied", help } }
      levelTarget = onLevel
      return dictation.start().then(
        () => ({}),
        (error: unknown) => ({ error: failure(error) }),
      )
    },
    async stop(): Promise<{ text?: string; error?: DictationFailure }> {
      levelTarget = undefined
      return dictation.stop().then(
        (text) => ({ text }),
        (error: unknown) => ({ error: failure(error) }),
      )
    },
    cancel() {
      levelTarget = undefined
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
      await dictation
        .reload()
        .catch((error: unknown) =>
          writeLog("dictation", "model reload failed", {
            code: error instanceof DictationError ? error.code : "unknown",
          }),
        )
    },
    download(id: unknown, onProgress: (progress: DictationDownloadProgress) => void) {
      if (!isModelID(id)) return Promise.reject(new Error("Unknown dictation model"))
      const running = downloads.get(id)
      if (running) return running
      const task = downloadModel(id, modelPath(id), onProgress).finally(() => downloads.delete(id))
      downloads.set(id, task)
      return task.then(async () => {
        // The first model someone downloads becomes the one dictation uses.
        await ready
        if (!active || !existsSync(modelPath(active))) await service.setActive(id)
      })
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
  // Linux has no system-level microphone switch Electron can read; the engine reports failures.
  if (process.platform !== "darwin" && process.platform !== "win32") return "granted"
  const status = systemPreferences.getMediaAccessStatus("microphone")
  if (process.platform === "darwin" && status === "not-determined")
    return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied"
  // Windows reports "not-determined" until the first capture; the engine reports a denial then.
  return status
}

function engineCommand() {
  const override = process.env.TENON_DICTATION_ENGINE
  if (override) return override
  const file = dictationEngineFile(process.platform)
  if (app.isPackaged) return join(process.resourcesPath, "dictation", file)
  // Development: the cargo release build next to this package (see docs/release-operations.md).
  return join(app.getAppPath(), "..", "dictation", "target", "release", file)
}

function modelFile(id: DictationModelID) {
  return DICTATION_MODELS.find((model) => model.id === id)!.file
}

function isModelID(value: unknown): value is DictationModelID {
  return DICTATION_MODELS.some((model) => model.id === value)
}

/** Streams the model to a `.part` file, checks its size and SHA-256, then moves it into place. */
async function downloadModel(
  id: DictationModelID,
  target: string,
  onProgress: (progress: DictationDownloadProgress) => void,
) {
  const model = DICTATION_MODELS.find((entry) => entry.id === id)!
  const partial = `${target}.part`
  await mkdir(join(target, ".."), { recursive: true })
  const response = await fetch(dictationModelURL(model))
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`)
  const hash = createHash("sha256")
  let received = 0
  let reported = 0
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>)
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk)
    received += chunk.length
    if (received - reported < 1_000_000 && received < model.size) return
    reported = received
    onProgress({ id, received, total: model.size })
  })
  await pipeline(body, createWriteStream(partial)).catch(async (error: unknown) => {
    await rm(partial, { force: true })
    throw error
  })
  const size = (await stat(partial)).size
  if (size !== model.size || hash.digest("hex") !== model.sha256) {
    await rm(partial, { force: true })
    throw new Error("The downloaded model did not match its checksum")
  }
  await rename(partial, target)
}
