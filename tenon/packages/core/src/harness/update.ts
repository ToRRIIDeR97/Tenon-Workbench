export * as HarnessUpdate from "./update"

import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { NpmConfig } from "../npm-config"
import type { AppProcess } from "../process"
import { which } from "../util/which"

export type Source =
  | {
      readonly method: "npm" | "bun" | "pnpm"
      readonly packageName: string
      readonly packageDir: string
      readonly prefix: string
    }
  | {
      readonly method: "brew"
      readonly name: string
      readonly cask: boolean
      readonly brew: string
      readonly version: string
    }
  | { readonly method: "winget"; readonly id: string }
  | { readonly method: "scoop"; readonly name: string; readonly root: string; readonly version?: string }
  | { readonly method: "choco"; readonly name: string }
  | { readonly method: "pipx" | "uv"; readonly name: string }
  | {
      readonly method: "self"
      readonly bin: string
      readonly args: ReadonlyArray<string>
      readonly packageName?: string
    }

export type Method = Source["method"]

export interface Check {
  readonly version?: string
  readonly latest?: string
  readonly updateAvailable: boolean
  readonly method?: Method
  readonly command?: string
  readonly manual?: boolean
  readonly error?: string
}

export class UpdateError extends Schema.TaggedError<UpdateError>()("HarnessUpdate.UpdateError", {
  reason: Schema.Literals(["not-found", "not-updatable", "update-failed"]),
  message: Schema.String,
}) {}

const checkTTL = 6 * 60 * 60 * 1000
const failedCheckTTL = 10 * 60 * 1000
const packageName = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const simpleName = /^[A-Za-z0-9][A-Za-z0-9@._+-]*$/
const checks = new Map<string, { readonly expires: number; readonly check: Check }>()

const selfUpdaters: Record<string, { readonly args: ReadonlyArray<string>; readonly packageName: string }> = {
  claude: { args: ["update"], packageName: "@anthropic-ai/claude-code" },
  codex: { args: ["update"], packageName: "@openai/codex" },
  opencode: { args: ["upgrade"], packageName: "opencode-ai" },
}

export function sourceFromPath(file: string, expected?: string): Source | undefined {
  const normalized = file.replaceAll("\\", "/")
  const slash = normalized.lastIndexOf("/")
  const folder = normalized.slice(0, slash)
  const base = normalized.slice(slash + 1)
  if (expected && packageName.test(expected) && /\/(npm|nodejs)$/i.test(folder) && /^[^./]+(\.(cmd|ps1))?$/i.test(base))
    return { method: "npm", packageName: expected, packageDir: `${folder}/node_modules/${expected}`, prefix: folder }
  const cellar = normalized.match(/^(.*)\/(Cellar|Caskroom)\/([^/]+)\/([^/]+)\//)
  const brewPrefixes = new Set(["/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"])
  if (process.env.HOMEBREW_PREFIX)
    brewPrefixes.add(process.env.HOMEBREW_PREFIX.replaceAll("\\", "/").replace(/\/+$/, ""))
  if (cellar && simpleName.test(cellar[3]!) && brewPrefixes.has(cellar[1]!)) {
    return {
      method: "brew",
      name: cellar[3]!,
      cask: cellar[2] === "Caskroom",
      brew: `${cellar[1]}/bin/brew`,
      version: cellar[4]!.replace(/_\d+$/, ""),
    }
  }
  const winget = normalized.match(/\/Microsoft\/WinGet\/Packages\/([^/]+?)_[^/_]+_[^/_]+\//i)
  if (winget && simpleName.test(winget[1]!)) return { method: "winget", id: winget[1]! }
  const scoop = normalized.match(/^(.*\/scoop)\/apps\/([^/]+)\/([^/]+)\//i)
  if (scoop && simpleName.test(scoop[2]!))
    return {
      method: "scoop",
      root: scoop[1]!,
      name: scoop[2]!,
      version: scoop[3] === "current" ? undefined : scoop[3],
    }
  const choco = normalized.match(/\/chocolatey\/lib\/([^/]+)\//i)
  if (choco && simpleName.test(choco[1]!)) return { method: "choco", name: choco[1]! }
  const pipx = normalized.match(/\/pipx\/venvs\/([^/]+)\//i)
  if (pipx && simpleName.test(pipx[1]!)) return { method: "pipx", name: pipx[1]! }
  const uv = normalized.match(/\/uv\/tools\/([^/]+)\//i)
  if (uv && simpleName.test(uv[1]!)) return { method: "uv", name: uv[1]! }
  const index = normalized.indexOf("/node_modules/")
  if (index === -1) return
  const root = normalized.slice(0, index)
  const parts = normalized.slice(index + "/node_modules/".length).split("/")
  const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]
  if (!name || !packageName.test(name)) return
  const packageDir = `${root}/node_modules/${name}`
  if (root.endsWith("/.bun/install/global")) return { method: "bun", packageName: name, packageDir, prefix: root }
  if (/\/pnpm\/global\/\d+$/i.test(root)) return { method: "pnpm", packageName: name, packageDir, prefix: root }
  if (root.endsWith("/lib")) return { method: "npm", packageName: name, packageDir, prefix: root.slice(0, -4) }
  if (/\/(npm|nodejs)$/i.test(root)) return { method: "npm", packageName: name, packageDir, prefix: root }
}

export function shimTarget(shim: string, text: string) {
  const match = text.match(/node_modules[\\/]((?:@[^\\/"'\s]+[\\/])?[^\\/"'\s]+)[\\/]/)
  if (!match) return
  const name = match[1]!.replaceAll("\\", "/")
  return packageName.test(name) ? path.join(path.dirname(shim), "node_modules", name, "package.json") : undefined
}

export function newer(latest: string, current: string) {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(/[-+]/)[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export const resolve = (command: string, expected?: string) =>
  Effect.promise(async () => {
    const found = command.includes("/") || command.includes("\\") ? command : which(command)
    if (!found) return
    const real = await fs.realpath(found).catch(() => undefined)
    if (!real) return
    const source = sourceFromPath(real, expected) ?? (await fromShim(real)) ?? selfSource(real)
    return { path: real, source }
  })

async function fromShim(file: string) {
  if (!/\.(cmd|ps1)$|^[^.]+$/i.test(path.basename(file))) return
  const text = await fs.readFile(file, "utf8").catch(() => undefined)
  if (!text || text.length > 64_000) return
  const manifest = shimTarget(file, text)
  return manifest ? sourceFromPath(manifest) : undefined
}

function selfSource(file: string): Source | undefined {
  const updater =
    selfUpdaters[
      path
        .basename(file)
        .replace(/\.(exe|cmd)$/i, "")
        .toLowerCase()
    ]
  return updater ? { method: "self", bin: file, ...updater } : undefined
}

export const check = Effect.fn("HarnessUpdate.check")(function* (
  process: Pick<AppProcess.Interface, "run">,
  command: string,
  fallbackVersion?: string,
  expected?: string,
) {
  const resolved = yield* resolve(command, expected)
  if (!resolved) return { version: fallbackVersion, updateAvailable: false } satisfies Check
  const cached = checks.get(resolved.path)
  if (cached && cached.expires > Date.now()) return cached.check
  const source = resolved.source
  if (!source) return { version: fallbackVersion, updateAvailable: false } satisfies Check
  const plan = updateCommand(source)
  const result: Check = yield* Effect.gen(function* () {
    const version = (yield* installedVersion(source)) ?? fallbackVersion
    const latest = yield* latestVersion(process, source)
    return {
      version,
      latest,
      method: source.method,
      command: plan.display,
      manual: plan.manual || undefined,
      updateAvailable: source.method === "self" && !latest ? true : !!version && !!latest && newer(latest, version),
    } satisfies Check
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.succeed({
        version: fallbackVersion,
        method: source.method,
        command: plan.display,
        manual: plan.manual || undefined,
        updateAvailable: false,
        error: error instanceof Error ? error.message : "Could not check for updates.",
      } satisfies Check),
    ),
  )
  const ttl = result.error || (!result.latest && source.method !== "self") ? failedCheckTTL : checkTTL
  checks.set(resolved.path, { expires: Date.now() + ttl, check: result })
  return result
})

export const upgrade = Effect.fn("HarnessUpdate.upgrade")(function* (
  process: Pick<AppProcess.Interface, "run">,
  command: string,
  expected?: string,
) {
  const resolved = yield* resolve(command, expected)
  const source = resolved?.source
  if (!resolved) return yield* new UpdateError({ reason: "not-updatable", message: `${command} is not on PATH.` })
  if (!source)
    return yield* new UpdateError({
      reason: "not-updatable",
      message: `The app can't tell how ${command} was installed, so update it the way you installed it.`,
    })
  const plan = updateCommand(source)
  if (plan.manual)
    return yield* new UpdateError({
      reason: "not-updatable",
      message: `Updating ${command} needs an administrator prompt. Run: ${plan.display}`,
    })
  const result = yield* process
    .run(ChildProcess.make(plan.bin, [...plan.args], { cwd: os.homedir() }), {
      timeout: "5 minutes",
      maxErrorBytes: 16_384,
    })
    .pipe(
      Effect.mapError(
        (error) => new UpdateError({ reason: "update-failed", message: `Could not run ${plan.bin}: ${error.message}` }),
      ),
    )
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim().split("\n").slice(-3).join("\n")
    return yield* new UpdateError({
      reason: "update-failed",
      message: `${plan.bin} exited with code ${result.exitCode}${detail ? `: ${detail}` : "."}`,
    })
  }
  checks.delete(resolved.path)
})

export const upgradeCompanion = Effect.fn("HarnessUpdate.upgradeCompanion")(function* (
  process: Pick<AppProcess.Interface, "run">,
  command: string,
) {
  const resolved = yield* resolve(command)
  const source = resolved?.source
  if (!resolved || !source) return
  const plan = updateCommand(source)
  if (plan.manual) return
  yield* process
    .run(ChildProcess.make(plan.bin, [...plan.args], { cwd: os.homedir() }), { timeout: "5 minutes" })
    .pipe(Effect.ignore)
  checks.delete(resolved.path)
})

export function updateCommand(source: Source): {
  readonly bin: string
  readonly args: ReadonlyArray<string>
  readonly display: string
  readonly manual: boolean
} {
  const plan = (bin: string, args: ReadonlyArray<string>, manual = false) => ({
    bin,
    args,
    manual,
    display: [path.basename(bin), ...args].join(" "),
  })
  switch (source.method) {
    case "brew":
      return plan(source.brew, ["upgrade", ...(source.cask ? ["--cask"] : []), source.name])
    case "bun":
      return plan("bun", ["add", "--global", `${source.packageName}@latest`])
    case "pnpm":
      return plan("pnpm", ["add", "--global", `${source.packageName}@latest`])
    case "npm":
      return plan("npm", ["install", "--global", "--prefix", source.prefix, `${source.packageName}@latest`])
    case "winget":
      return plan("winget", [
        "upgrade",
        "--id",
        source.id,
        "--exact",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ])
    case "scoop":
      return plan("scoop", ["update", source.name])
    case "choco":
      return plan("choco", ["upgrade", source.name, "-y"], true)
    case "pipx":
      return plan("pipx", ["upgrade", source.name])
    case "uv":
      return plan("uv", ["tool", "upgrade", source.name])
    case "self":
      return plan(source.bin, source.args)
  }
}

function installedVersion(source: Source): Effect.Effect<string | undefined> {
  if (source.method === "brew") return Effect.succeed(source.version)
  if (source.method === "scoop" && source.version) return Effect.succeed(source.version)
  if (source.method !== "npm" && source.method !== "bun" && source.method !== "pnpm") return Effect.succeed(undefined)
  return Effect.promise(() => readVersion(path.join(source.packageDir, "package.json")))
}

function latestVersion(
  process: Pick<AppProcess.Interface, "run">,
  source: Source,
): Effect.Effect<string | undefined, unknown> {
  switch (source.method) {
    case "brew":
      return process
        .run(ChildProcess.make(source.brew, ["info", "--json=v2", ...(source.cask ? ["--cask"] : []), source.name]), {
          timeout: "30 seconds",
          maxOutputBytes: 4_000_000,
        })
        .pipe(
          Effect.map((result) => {
            const info = JSON.parse(result.stdout.toString()) as {
              formulae?: Array<{ versions?: { stable?: string } }>
              casks?: Array<{ version?: string }>
            }
            const version = source.cask ? info.casks?.[0]?.version : info.formulae?.[0]?.versions?.stable
            return version?.split(",")[0]
          }),
        )
    case "winget":
      return process
        .run(ChildProcess.make("winget", ["show", "--id", source.id, "--exact", "--accept-source-agreements"]), {
          timeout: "30 seconds",
          maxOutputBytes: 1_000_000,
        })
        .pipe(Effect.map((result) => result.stdout.toString().match(/^Version:\s*(\S+)/m)?.[1]))
    case "scoop":
      return Effect.promise(() => scoopManifestVersion(source.root, source.name))
    case "pipx":
    case "uv":
      return fetchVersion(`https://pypi.org/pypi/${encodeURIComponent(source.name)}/json`, (body) =>
        isRecord(body) && isRecord(body.info) && typeof body.info.version === "string" ? body.info.version : undefined,
      )
    case "choco":
      return Effect.succeed(undefined)
    case "self":
    case "npm":
    case "bun":
    case "pnpm": {
      const name = source.packageName
      if (!name) return Effect.succeed(undefined)
      return NpmConfig.registry(os.homedir()).pipe(
        Effect.flatMap((registry) =>
          fetchVersion(`${registry}/${name}/latest`, (body) =>
            isRecord(body) && typeof body.version === "string" ? body.version : undefined,
          ),
        ),
      )
    }
  }
}

function fetchVersion(url: string, read: (body: unknown) => string | undefined) {
  return Effect.tryPromise(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } })
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`)
    return read(await response.json())
  })
}

async function scoopManifestVersion(root: string, name: string) {
  const buckets = await fs.readdir(path.join(root, "buckets")).catch(() => [])
  for (const bucket of buckets) {
    const version = await readVersion(path.join(root, "buckets", bucket, "bucket", `${name}.json`))
    if (version) return version
  }
}

async function readVersion(file: string) {
  const text = await fs.readFile(file, "utf8").catch(() => undefined)
  if (!text) return
  const version: unknown = JSON.parse(text).version
  return typeof version === "string" ? version : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
