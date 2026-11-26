import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path, { join } from "node:path"

export type DevicePlatform = "android" | "ios"
export type Device = { platform: DevicePlatform; id: string; name: string; state: string }
export type DeviceStatus = {
  android: { sdk: boolean; devices: Device[]; avds: string[] }
  ios: { supported: boolean; devices: Device[]; input: boolean }
}

const exe = process.platform === "win32" ? ".exe" : ""

const present = (value: string | undefined): value is string => !!value && value.trim() !== ""

export function sdkRootCandidates(input: {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  home: string
}): string[] {
  const paths = input.platform === "win32" ? path.win32 : path.posix
  const fallback = () => {
    if (input.platform === "win32")
      return present(input.env.LOCALAPPDATA) ? paths.join(input.env.LOCALAPPDATA, "Android", "Sdk") : undefined
    if (!present(input.home)) return undefined
    if (input.platform === "darwin") return paths.join(input.home, "Library", "Android", "sdk")
    return paths.join(input.home, "Android", "Sdk")
  }
  return [input.env.ANDROID_HOME, input.env.ANDROID_SDK_ROOT, fallback()]
    .filter(present)
    .filter((dir) => paths.isAbsolute(dir))
}

function sdkRoot() {
  return sdkRootCandidates({ env: process.env, platform: process.platform, home: homedir() }).find((dir) =>
    existsSync(join(dir, "platform-tools", `adb${exe}`)),
  )
}

const adbPath = () => {
  const root = sdkRoot()
  return root ? join(root, "platform-tools", `adb${exe}`) : undefined
}
const emulatorPath = () => {
  const root = sdkRoot()
  const file = root ? join(root, "emulator", `emulator${exe}`) : undefined
  return file && existsSync(file) ? file : undefined
}

function run(file: string, args: string[], options: { timeout?: number; binary?: boolean } = {}) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: options.timeout ?? 15_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer", windowsHide: true },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr.toString().trim() || error.message)) : resolve(stdout),
    )
  })
}

const which = (name: string) =>
  run(process.platform === "win32" ? "where" : "which", [name], { timeout: 3_000 }).then(
    (out) => out.toString().split(/\r?\n/)[0]?.trim() || undefined,
    () => undefined,
  )

export async function deviceStatus(): Promise<DeviceStatus> {
  const adb = adbPath()
  const emulator = emulatorPath()
  const [android, avds, ios, idb] = await Promise.all([
    adb ? run(adb, ["devices", "-l"]).then(parseAdbDevices, () => []) : Promise.resolve([]),
    emulator
      ? run(emulator, ["-list-avds"]).then(
          (out) =>
            out
              .toString()
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          () => [],
        )
      : Promise.resolve([]),
    process.platform === "darwin"
      ? run("xcrun", ["simctl", "list", "devices", "-j"]).then(parseSimctl, () => [])
      : Promise.resolve([]),
    process.platform === "darwin" ? which("idb") : Promise.resolve(undefined),
  ])
  return {
    android: { sdk: !!adb, devices: android, avds },
    ios: { supported: process.platform === "darwin", devices: ios, input: !!idb },
  }
}

export function parseAdbDevices(out: Buffer | string): Device[] {
  return out
    .toString()
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const [id, state, ...rest] = line.trim().split(/\s+/)
      if (!id || !state) return []
      const model = rest
        .find((part) => part.startsWith("model:"))
        ?.slice(6)
        .replaceAll("_", " ")
      return [{ platform: "android" as const, id, state, name: model ?? id }]
    })
}

export function parseSimctl(out: Buffer | string): Device[] {
  const value = JSON.parse(out.toString()) as {
    devices?: Record<string, Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>>
  }
  return Object.entries(value.devices ?? {})
    .filter(([runtime]) => runtime.includes("iOS"))
    .flatMap(([, devices]) => devices)
    .filter((device) => device.isAvailable !== false)
    .map((device) => ({ platform: "ios" as const, id: device.udid, name: device.name, state: device.state }))
}

export async function bootDevice(platform: DevicePlatform, id: string) {
  if (platform === "android") {
    const emulator = emulatorPath()
    if (!emulator) throw new Error("The Android emulator isn't installed. Add it with the Android SDK Manager.")
    if (!/^[\w.-]+$/.test(id)) throw new Error("That isn't an Android virtual device name.")
    spawn(emulator, ["-avd", id], { detached: true, stdio: "ignore", windowsHide: true }).unref()
    return
  }
  requireMac()
  await run("xcrun", ["simctl", "boot", id]).catch((error: Error) => {
    if (!/current state: Booted/i.test(error.message)) throw error
  })
}

export async function deviceScreenshot(platform: DevicePlatform, id: string) {
  if (platform === "android") return run(requireAdb(), ["-s", id, "exec-out", "screencap", "-p"], { timeout: 10_000 })
  requireMac()
  const file = join(tmpdir(), `tenon-sim-${Date.now()}.png`)
  await run("xcrun", ["simctl", "io", id, "screenshot", file])
  const png = await readFile(file)
  await rm(file, { force: true })
  return png
}

export type DeviceInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: "home" | "back" | "enter" }

export type DeviceCommand = { tool: "adb" | "idb"; args: string[] }

const coordinate = (value: number) =>
  typeof value === "number" && Number.isFinite(value) ? String(Math.max(0, Math.round(value))) : "0"
const ANDROID_KEYS = { home: "KEYCODE_HOME", back: "KEYCODE_BACK", enter: "KEYCODE_ENTER" } as const
const IOS_RETURN_KEY = "40"

function androidCommands(id: string, input: DeviceInput): DeviceCommand[] {
  const adb = (...args: string[]): DeviceCommand => ({ tool: "adb", args: ["-s", id, "shell", "input", ...args] })
  if (input.kind === "tap") return [adb("tap", coordinate(input.x), coordinate(input.y))]
  if (input.kind === "swipe")
    return [adb("swipe", coordinate(input.x), coordinate(input.y), coordinate(input.toX), coordinate(input.toY), "300")]
  if (input.kind === "key") return [adb("keyevent", ANDROID_KEYS[input.key])]
  if (/[^\x20-\x7e\r\n]|\r(?!\n)/.test(input.text))
    throw new Error(
      "Android can only type printable ASCII text and line breaks. Remove accents, emoji and other characters.",
    )
  if (input.text === "") return []
  return input.text
    .split(/\r?\n/)
    .flatMap((line, index) => [
      ...(index > 0 ? [adb("keyevent", ANDROID_KEYS.enter)] : []),
      ...(line === "" ? [] : [adb("text", androidText(line))]),
    ])
}

function iosCommands(id: string, input: DeviceInput): DeviceCommand[] {
  const idb = (...args: string[]): DeviceCommand => ({ tool: "idb", args: ["ui", ...args] })
  if (input.kind === "tap") return [idb("tap", "--udid", id, coordinate(input.x), coordinate(input.y))]
  if (input.kind === "swipe")
    return [
      idb(
        "swipe",
        "--udid",
        id,
        coordinate(input.x),
        coordinate(input.y),
        coordinate(input.toX),
        coordinate(input.toY),
      ),
    ]
  if (input.kind === "text") return input.text === "" ? [] : [idb("text", "--udid", id, input.text)]
  if (input.key === "back")
    throw new Error("The iOS Simulator has no Back button. Use Home, or tap the app's own back control.")
  if (input.key === "enter") return [idb("key", "--udid", id, IOS_RETURN_KEY)]
  return [idb("button", "--udid", id, "HOME")]
}

const INPUT_KINDS: ReadonlySet<unknown> = new Set(["tap", "swipe", "text", "key"])
const INPUT_KEYS: ReadonlySet<unknown> = new Set(Object.keys(ANDROID_KEYS))

function checkInput(input: DeviceInput) {
  const value: unknown = input
  if (typeof value !== "object" || value === null || !("kind" in value) || !INPUT_KINDS.has(value.kind))
    throw new Error("Device input must be a tap, swipe, text or key.")
  if (value.kind === "key" && (!("key" in value) || !INPUT_KEYS.has(value.key)))
    throw new Error("Device keys are home, back and enter.")
  if (value.kind === "text" && (!("text" in value) || typeof value.text !== "string"))
    throw new Error("Device text must be a string.")
}

export function inputCommands(platform: DevicePlatform, id: string, input: DeviceInput): DeviceCommand[] {
  checkInput(input)
  return platform === "android" ? androidCommands(id, input) : iosCommands(id, input)
}

async function inputTool(platform: DevicePlatform) {
  if (platform === "android") return requireAdb()
  requireMac()
  const idb = await which("idb")
  if (!idb) throw new Error("Taps on the iOS Simulator need idb (brew install idb-companion, pipx install fb-idb).")
  return idb
}

export async function deviceInput(platform: DevicePlatform, id: string, input: DeviceInput) {
  const commands = inputCommands(platform, id, input)
  if (commands.length === 0) return
  const file = await inputTool(platform)
  for (const command of commands) await run(file, command.args)
}

export function androidText(text: string) {
  return text.replace(/[^\w.@:/-]/g, (char) => (char === " " ? "%s" : `\\${char}`))
}

export async function installApp(platform: DevicePlatform, id: string, file: string) {
  if (platform === "android") return run(requireAdb(), ["-s", id, "install", "-r", file], { timeout: 180_000 })
  requireMac()
  return run("xcrun", ["simctl", "install", id, file], { timeout: 180_000 })
}

export async function launchApp(platform: DevicePlatform, id: string, app: string) {
  if (!/^[\w.]+$/.test(app)) throw new Error("App IDs look like com.example.app.")
  if (platform === "android")
    return run(requireAdb(), ["-s", id, "shell", "monkey", "-p", app, "-c", "android.intent.category.LAUNCHER", "1"])
  requireMac()
  return run("xcrun", ["simctl", "launch", id, app])
}

export async function deviceLogs(platform: DevicePlatform, id: string, lines = 200) {
  if (platform === "android")
    return (await run(requireAdb(), ["-s", id, "logcat", "-d", "-t", String(lines)])).toString()
  requireMac()
  return (
    await run("xcrun", ["simctl", "spawn", id, "log", "show", "--last", "2m", "--style", "compact"], {
      timeout: 30_000,
    })
  )
    .toString()
    .split("\n")
    .slice(-lines)
    .join("\n")
}

function requireAdb() {
  const adb = adbPath()
  if (!adb) throw new Error("Android tools weren't found. Install the Android SDK platform-tools, or set ANDROID_HOME.")
  return adb
}

function requireMac() {
  if (process.platform !== "darwin") throw new Error("The iOS Simulator only runs on macOS.")
}
