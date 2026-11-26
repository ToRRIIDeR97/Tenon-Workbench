export * as HarnessSetup from "./setup"

import { Harness } from "@tenon/schema/harness"
import { execFile } from "child_process"
import { Effect, Option, Schema, Semaphore } from "effect"
import { ChildProcess } from "effect/process"
import fs from "fs/promises"
import { parse } from "jsonc-parser"
import os from "os"
import path from "path"
import { promisify } from "util"
import type { AppProcess } from "../process"
import { HarnessDelegation } from "./delegation"
import { which } from "../util/which"

export interface Recipe {
  readonly id: Harness.InstanceID
  readonly packageName: string
  readonly command: string
  readonly signIn: "link" | "terminal"
  readonly login?: ReadonlyArray<string>
  readonly apiKeys: ReadonlyArray<{ readonly id: string; readonly label: string; readonly env?: string }>
}

export const recipes: ReadonlyArray<Recipe> = [
  {
    id: Harness.Codex,
    packageName: "@openai/codex",
    command: "codex",
    signIn: "link",
    apiKeys: [{ id: "openai", label: "OpenAI API key" }],
  },
  {
    id: Harness.ClaudeCode,
    packageName: "@agentclientprotocol/claude-agent-acp",
    command: "claude-agent-acp",
    signIn: "terminal",
    login: ["claude-agent-acp", "--cli", "auth", "login", "--claudeai"],
    apiKeys: [{ id: "anthropic", label: "Anthropic API key", env: "ANTHROPIC_API_KEY" }],
  },
  {
    id: Harness.OpenCodeAcp,
    packageName: "opencode-ai",
    command: "opencode",
    signIn: "terminal",
    login: ["opencode", "auth", "login"],
    apiKeys: [
      { id: "anthropic", label: "Anthropic API key", env: "ANTHROPIC_API_KEY" },
      { id: "openai", label: "OpenAI API key", env: "OPENAI_API_KEY" },
      { id: "openrouter", label: "OpenRouter API key", env: "OPENROUTER_API_KEY" },
    ],
  },
]

export const recipe = (id: string) => recipes.find((item) => item.id === id)

export class SetupError extends Schema.TaggedError<SetupError>()("HarnessSetup.SetupError", {
  reason: Schema.Literals(["not-found", "invalid-input", "install-failed", "sign-in-failed", "write-failed"]),
  message: Schema.String,
}) {}

export const install = Effect.fn("HarnessSetup.install")(function* (
  process: Pick<AppProcess.Interface, "run">,
  item: Recipe,
) {
  const npm = which("npm")
  if (!npm)
    return yield* new SetupError({
      reason: "install-failed",
      message: "npm is not on PATH. Install Node.js 22 or newer from https://nodejs.org, then try again.",
    })
  const result = yield* process
    .run(ChildProcess.make(npm, ["install", "--global", `${item.packageName}@latest`], { cwd: os.homedir() }), {
      timeout: "10 minutes",
      maxErrorBytes: 16_384,
    })
    .pipe(
      Effect.mapError(
        (error) => new SetupError({ reason: "install-failed", message: `Could not run npm: ${error.message}` }),
      ),
    )
  if (result.exitCode === 0) return undefined
  const detail = result.stderr.toString().trim().split("\n").slice(-3).join("\n")
  return yield* new SetupError({
    reason: "install-failed",
    message: `npm exited with code ${result.exitCode}${detail ? `: ${detail}` : "."}`,
  })
})

export const openCodeDataDir = (env: Readonly<Record<string, string | undefined>> = process.env) =>
  path.join(env.XDG_DATA_HOME ?? path.join(env.HOME ?? os.homedir(), ".local", "share"), "opencode")

export const signedIn = (item: Recipe, env: Readonly<Record<string, string | undefined>> = process.env) =>
  Effect.promise(async (): Promise<"signed-in" | "signed-out" | "unknown"> => {
    const home = env.HOME ?? os.homedir()
    if (item.id === Harness.ClaudeCode) {
      const file = env.CLAUDE_CONFIG_DIR
        ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json")
        : path.join(home, ".claude.json")
      const value = await readJson(file)
      return isRecord(value) && isRecord(value.oauthAccount) ? "signed-in" : "signed-out"
    }
    if (item.id === Harness.OpenCodeAcp) {
      const value = await readJson(path.join(openCodeDataDir(env), "auth.json"))
      return isRecord(value) && Object.keys(value).length > 0 ? "signed-in" : "signed-out"
    }
    return "unknown"
  })

export const fileName = "harness-credentials.json"
const writeLock = Semaphore.makeUnsafe(1)
let keysRevision = 0
export const keysVersion = () => keysRevision

export type Keys = Readonly<Record<string, { readonly option: string; readonly key: string }>>

export const readKeys = (dataDir: string): Effect.Effect<Keys> =>
  Effect.promise(async () => {
    const value = await readJson(path.join(dataDir, fileName))
    if (!isRecord(value)) return {}
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, entry]) =>
        isRecord(entry) && typeof entry.option === "string" && typeof entry.key === "string"
          ? [[id, { option: entry.option, key: entry.key }] as const]
          : [],
      ),
    )
  })

export const writeKey = (
  dataDir: string,
  id: string,
  value: { readonly option: string; readonly key: string } | undefined,
) =>
  Effect.gen(function* () {
    const current = yield* readKeys(dataDir)
    const next = Object.fromEntries(Object.entries({ ...current, [id]: value }).filter(([, entry]) => entry))
    yield* Effect.tryPromise({
      try: () => writeAtomic(path.join(dataDir, fileName), `${JSON.stringify(next, null, 2)}\n`),
      catch: (cause) =>
        new SetupError({ reason: "write-failed", message: `Could not save ${fileName}: ${String(cause)}` }),
    })
    keysRevision += 1
  }).pipe(writeLock.withPermits(1))

export function keyEnvironment(item: Recipe | undefined, stored: Keys[string] | undefined): Record<string, string> {
  const env = item?.apiKeys.find((option) => option.id === stored?.option)?.env
  if (!env || !stored) return {}
  return item?.id === Harness.ClaudeCode
    ? { [env]: stored.key, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" }
    : { [env]: stored.key }
}

export function claudeCodeLaunchEnv(inherited: Record<string, string | undefined>): Record<string, string> {
  const limit = String((HarnessDelegation.MAX_WAIT_SECONDS + 60) * 1_000)
  return Object.fromEntries(
    ["MCP_TOOL_TIMEOUT", "CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT"]
      .filter((name) => inherited[name] === undefined)
      .map((name) => [name, limit]),
  )
}

export function openCodeLaunchEnv(userConfig: string | undefined): Record<string, string> {
  const parsed: unknown = userConfig === undefined ? undefined : parse(userConfig, [], { allowTrailingComma: true })
  const user = isRecord(parsed) ? parsed : {}
  const experimental = isRecord(user.experimental) ? user.experimental : {}
  const extra = {
    ...(experimental.mcp_timeout === undefined
      ? { mcp_timeout: (HarnessDelegation.MAX_WAIT_SECONDS + 60) * 1_000 }
      : {}),
    ...(experimental.todo === undefined ? { todo: true } : {}),
  }
  const config = {
    ...(user.permission === undefined ? { permission: { edit: "ask", bash: "ask" } } : {}),
    ...(Object.keys(extra).length > 0 ? { experimental: extra } : {}),
  }
  if (Object.keys(config).length === 0) return {}
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }
}

export const readOpenCodeUserConfig = (env: Readonly<Record<string, string | undefined>> = process.env) =>
  Effect.promise(async () => {
    const dir = path.join(env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? os.homedir(), ".config"), "opencode")
    for (const name of ["opencode.jsonc", "opencode.json", "config.json"]) {
      const text = await fs.readFile(path.join(dir, name), "utf8").catch(() => undefined)
      if (text !== undefined) return text
    }
    return undefined
  })

async function writeAtomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temp, "", { mode: 0o600 })
    await restrictToCurrentUser(temp)
    await fs.writeFile(temp, content, { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

export const windowsAccountName = (env: Readonly<Record<string, string | undefined>>, username: string) =>
  env.USERDOMAIN ? `${env.USERDOMAIN}\\${username}` : username

export const icaclsPath = (env: Readonly<Record<string, string | undefined>>) =>
  path.win32.join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", "icacls.exe")

export const privateAccessArgs = (file: string, account: string) => [file, "/inheritance:r", "/grant:r", `${account}:F`]

async function restrictToCurrentUser(file: string) {
  if (process.platform !== "win32") return
  const account = windowsAccountName(process.env, os.userInfo().username)
  await promisify(execFile)(icaclsPath(process.env), privateAccessArgs(file, account), { windowsHide: true })
}

async function readJson(file: string) {
  return Option.getOrUndefined(decodeJson(await fs.readFile(file, "utf8").catch(() => "")))
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
