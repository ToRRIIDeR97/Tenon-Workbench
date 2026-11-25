import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app, utilityProcess } from "electron"
import type { Details } from "electron"
import { CHANNEL } from "./constants"
import { stableDatabaseName } from "./database-name"
import { getLogger } from "./logging"
import { fallbackPath, getUserShell, loadShellEnv, readRegistryPaths, windowsPath } from "./shell-env"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY, VAULT_FOLDER_KEY } from "./store-keys"
import { vaultFolder } from "./vault-folder"

type SidecarMessage =
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

export type SidecarListener = { stop: () => Promise<void> }

const SIDECAR_SERVICE_NAME = "tenon server"
const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
  env?: Record<string, string>
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export async function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? await loadShellEnv(shell, getLogger()) : null
  Object.assign(process.env, {
    ...shellEnv,
    TENON_EXPERIMENTAL_ICON_DISCOVERY: "true",
    TENON_EXPERIMENTAL_FILEWATCHER: "true",
    TENON_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
  if (!shellEnv && process.platform !== "win32")
    process.env.PATH = fallbackPath(process.env.PATH ?? "", app.getPath("home"))
  if (process.platform === "win32")
    process.env.PATH = windowsPath(process.env.PATH ?? "", await readRegistryPaths(), process.env)
  const database = stableDatabaseName(CHANNEL, app.isPackaged)
  if (!process.env.TENON_DB && database) process.env.TENON_DB = database
  if (app.isPackaged)
    process.env.TENON_RIPGREP_PATH = join(
      process.resourcesPath,
      "ripgrep",
      process.platform === "win32" ? "rg.exe" : "rg",
    )
  process.env.TENON_VAULT_DIR = vaultFolder(getStore().get(VAULT_FOLDER_KEY), app.getPath("documents"))
  return shellEnv
}

export function spawnLocalServer(hostname: string, port: number, password: string, options: SpawnLocalServerOptions) {
  const sidecar = join(dirname(fileURLToPath(import.meta.url)), "sidecar.js")
  const child = utilityProcess.fork(sidecar, [], {
    cwd: homedir(),
    env: createSidecarEnv(process.env, options.env),
    serviceName: SIDECAR_SERVICE_NAME,
    stdio: "pipe",
  })
  let exited = false
  const exit = defer<number>()

  const onProcessGone = (_event: unknown, details: Details) => {
    if (details.type !== "Utility" || details.name !== SIDECAR_SERVICE_NAME) return
    options.onStderr?.(`utility process gone reason=${details.reason} exitCode=${details.exitCode}`)
  }

  app.on("child-process-gone", onProcessGone)
  child.once("exit", (code) => {
    exited = true
    app.off("child-process-gone", onProcessGone)
    options.onExit?.(code)
    exit.resolve(code)
  })
  child.on("error", (error) => options.onStderr?.(`utility process error: ${serializeError(error).message}`))

  child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

  const ready = new Promise<void>((resolve, reject) => {
    let done = false
    let timeout: NodeJS.Timeout

    const fail = (error: Error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }

    const refreshTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        fail(new Error(`Sidecar did not become ready within ${SIDECAR_START_STALL_TIMEOUT}ms: ${sidecar}`))
      }, SIDECAR_START_STALL_TIMEOUT)
    }

    const onMessage = (message: SidecarMessage) => {
      if (message.type === "ready") {
        if (done) return
        done = true
        cleanup()
        resolve()
        return
      }
      if (message.type === "error") {
        fail(Object.assign(new Error(message.error.message), { stack: message.error.stack }))
      }
    }
    const onExit = (code: number) => {
      fail(new Error(`Sidecar exited before ready with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.off("message", onMessage)
      child.off("exit", onExit)
    }

    child.on("message", onMessage)
    child.on("exit", onExit)
    refreshTimeout()
    child.postMessage({
      type: "start",
      hostname,
      port,
      password,
      userDataPath: options.userDataPath,
    })
  }).catch((error) => {
    if (!exited) child.kill()
    throw error
  })

  const waitHealthy = async (signal: AbortSignal) => {
    await ready
    const gone = new AbortController()
    void exit.promise.then(() => gone.abort())
    const stop = AbortSignal.any([signal, gone.signal])
    const url = `http://${hostname}:${port}`
    while (!stop.aborted) {
      if (await checkHealth(url, password, stop)) return
      await delay(100)
    }
    if (exited) throw new Error(`Sidecar exited before health check passed with code ${await exit.promise}`)
    throw new Error("Sidecar health check aborted")
  }

  let stopping: Promise<void> | undefined

  return {
    ready,
    exited: exit.promise,
    waitHealthy,
    stop: () => {
      if (stopping) return stopping
      if (exited) return Promise.resolve()
      child.postMessage({ type: "stop" })
      stopping = Promise.race([
        exit.promise.then(() => undefined),
        delay(SIDECAR_STOP_TIMEOUT).then(() => {
          if (!exited) child.kill()
        }),
      ])
      return stopping
    },
  }
}

let healthPaths = ["/api/health", "/global/health"]

export async function checkHealth(url: string, password?: string | null, signal?: AbortSignal): Promise<boolean> {
  try {
    new URL(url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  for (const path of healthPaths) {
    if (signal?.aborted) return false
    try {
      const res = await fetch(new URL(path, url), {
        method: "GET",
        headers,
        signal: signal ? AbortSignal.any([AbortSignal.timeout(3000), signal]) : AbortSignal.timeout(3000),
      })
      if (!res.ok) continue
      healthPaths = [path, ...healthPaths.filter((item) => item !== path)]
      return true
    } catch {}
  }
  return false
}

export function createSidecarEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(base).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (platform === "linux") delete env.LD_PRELOAD
  return { ...env, ...extra }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
