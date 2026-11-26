import { describe, expect, test } from "bun:test"
import { execFile } from "child_process"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { promisify } from "util"
import { Harness } from "@tenon/schema/harness"
import { HarnessSetup } from "@tenon/core/harness/setup"

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "harness-setup-"))

const currentAccount = () => HarnessSetup.windowsAccountName(process.env, os.userInfo().username)

const accessList = async (file: string) => {
  const { stdout } = await promisify(execFile)(HarnessSetup.icaclsPath(process.env), [file], { windowsHide: true })
  return stdout
    .replace(file, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(":("))
}

const protection = async (file: string) =>
  process.platform === "win32" ? { access: await accessList(file) } : { mode: (await fs.stat(file)).mode & 0o777 }

const privateProtection = () =>
  process.platform === "win32" ? { access: [`${currentAccount()}:(F)`] } : { mode: 0o600 }

describe("harness setup", () => {
  test("covers exactly the built-in external harnesses", () => {
    expect(HarnessSetup.recipes.map((item) => item.id)).toEqual([
      Harness.Codex,
      Harness.ClaudeCode,
      Harness.OpenCodeAcp,
    ])
    expect(HarnessSetup.recipe("gemini")).toBeUndefined()
    expect(HarnessSetup.recipe(Harness.OpenCode)).toBeUndefined()
  })

  test("stores one key per harness in a private file and bumps the revision", async () => {
    const dir = await temp()
    const before = HarnessSetup.keysVersion()
    await Effect.runPromise(HarnessSetup.writeKey(dir, "claude-code", { option: "anthropic", key: "sk-1" }))
    await Effect.runPromise(HarnessSetup.writeKey(dir, "opencode-acp", { option: "openai", key: "sk-2" }))
    expect(await Effect.runPromise(HarnessSetup.readKeys(dir))).toEqual({
      "claude-code": { option: "anthropic", key: "sk-1" },
      "opencode-acp": { option: "openai", key: "sk-2" },
    })
    expect(await protection(path.join(dir, HarnessSetup.fileName))).toEqual(privateProtection())
    await Effect.runPromise(HarnessSetup.writeKey(dir, "claude-code", undefined))
    expect(await Effect.runPromise(HarnessSetup.readKeys(dir))).toEqual({
      "opencode-acp": { option: "openai", key: "sk-2" },
    })
    expect(HarnessSetup.keysVersion()).toBe(before + 3)
  })

  test("restricts the key file on Windows to the signed-in account with icacls arguments, not a shell line", () => {
    const file = path.win32.join("C:\\Users\\ada\\AppData\\Roaming\\Tenon", HarnessSetup.fileName)
    expect(HarnessSetup.icaclsPath({ SystemRoot: "D:\\Windows" })).toBe("D:\\Windows\\System32\\icacls.exe")
    expect(HarnessSetup.icaclsPath({})).toBe("C:\\Windows\\System32\\icacls.exe")
    expect(HarnessSetup.windowsAccountName({ USERDOMAIN: "LAPTOP" }, "ada")).toBe("LAPTOP\\ada")
    expect(HarnessSetup.windowsAccountName({}, "ada")).toBe("ada")
    expect(HarnessSetup.privateAccessArgs(file, "LAPTOP\\ada")).toEqual([
      file,
      "/inheritance:r",
      "/grant:r",
      "LAPTOP\\ada:F",
    ])
  })

  test("turns a stored key into the harness's environment variable", () => {
    const opencode = HarnessSetup.recipe(Harness.OpenCodeAcp)
    expect(HarnessSetup.keyEnvironment(opencode, { option: "openrouter", key: "k" })).toEqual({
      OPENROUTER_API_KEY: "k",
    })
    expect(HarnessSetup.keyEnvironment(opencode, { option: "unknown", key: "k" })).toEqual({})
    expect(HarnessSetup.keyEnvironment(HarnessSetup.recipe(Harness.Codex), { option: "openai", key: "k" })).toEqual({})
  })

  test("reads sign-in state from each CLI's own files", async () => {
    const home = await temp()
    const claude = HarnessSetup.recipe(Harness.ClaudeCode)!
    const opencode = HarnessSetup.recipe(Harness.OpenCodeAcp)!
    const env = { HOME: home, XDG_DATA_HOME: path.join(home, "data") }
    expect(await Effect.runPromise(HarnessSetup.signedIn(claude, env))).toBe("signed-out")
    expect(await Effect.runPromise(HarnessSetup.signedIn(opencode, env))).toBe("signed-out")

    await fs.writeFile(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" } }))
    await fs.mkdir(path.join(home, "data", "opencode"), { recursive: true })
    await fs.writeFile(path.join(home, "data", "opencode", "auth.json"), JSON.stringify({ anthropic: { type: "api" } }))
    expect(await Effect.runPromise(HarnessSetup.signedIn(claude, env))).toBe("signed-in")
    expect(await Effect.runPromise(HarnessSetup.signedIn(opencode, env))).toBe("signed-in")
  })

  test("OpenCode launch config asks before edits and waits out Tenon's MCP calls", () => {
    const content = (userConfig?: string) =>
      JSON.parse(HarnessSetup.openCodeLaunchEnv(userConfig).OPENCODE_CONFIG_CONTENT ?? "null")
    expect(content()).toEqual({
      permission: { edit: "ask", bash: "ask" },
      experimental: { mcp_timeout: 660_000, todo: true },
    })
    expect(content('{ "permission": "allow", // mine\n }')).toEqual({
      experimental: { mcp_timeout: 660_000, todo: true },
    })
    expect(content('{ "experimental": { "mcp_timeout": 5000 } }')).toEqual({
      permission: { edit: "ask", bash: "ask" },
      experimental: { todo: true },
    })
    expect(content('{ "experimental": { "todo": false } }')).toEqual({
      permission: { edit: "ask", bash: "ask" },
      experimental: { mcp_timeout: 660_000 },
    })
    expect(
      HarnessSetup.openCodeLaunchEnv('{ "permission": {}, "experimental": { "mcp_timeout": 1, "todo": false } }'),
    ).toEqual({})
  })

  test("Claude Code's MCP calls wait as long as Tenon's tools hold them, unless Tenon's environment sets a limit", () => {
    expect(HarnessSetup.claudeCodeLaunchEnv({})).toEqual({
      MCP_TOOL_TIMEOUT: "660000",
      CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: "660000",
    })
    expect(HarnessSetup.claudeCodeLaunchEnv({ CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: "0" })).toEqual({
      MCP_TOOL_TIMEOUT: "660000",
    })
  })
})
