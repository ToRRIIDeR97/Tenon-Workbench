import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { mcpEntryFromForm, mcpNameProblem, mcpReach, mcpRowState } from "./mcp-servers-model"

const harnesses = [
  { name: "Tenon", driver: "opencode" },
  { name: "Codex", driver: "codex" },
  { name: "Claude Code", driver: "acp" },
]

describe("AC-10 a row's live state and the fix it offers", () => {
  test("a failed server shows its error and offers Retry", () => {
    expect(mcpRowState({ status: "failed", error: "spawn uvx ENOENT" })).toEqual({
      kind: "failed",
      error: "spawn uvx ENOENT",
      action: "retry",
    })
  })

  test("a server that needs sign-in offers Sign in", () => {
    expect(mcpRowState({ status: "needs_auth" })).toEqual({ kind: "needs_auth", action: "signin" })
  })

  test("a server that needs client registration shows why and offers Retry", () => {
    expect(mcpRowState({ status: "needs_client_registration", error: "no dynamic registration" })).toEqual({
      kind: "failed",
      error: "no dynamic registration",
      action: "retry",
    })
  })

  test("connected, off and unknown servers offer nothing", () => {
    expect(mcpRowState({ status: "connected" })).toEqual({ kind: "connected" })
    expect(mcpRowState({ status: "disabled" })).toEqual({ kind: "off" })
    expect(mcpRowState(undefined)).toEqual({ kind: "unknown" })
  })
})

describe("AC-10 which harnesses receive a server", () => {
  test("a local server reaches the built-in agent, Codex and ACP agents", () => {
    expect(mcpReach("postgres", { type: "local", command: ["uvx", "x"], enabled: true }, harnesses)).toEqual({
      receives: ["Tenon", "Codex", "Claude Code"],
      missing: [],
      maybe: [],
    })
  })

  test("a remote server reaches ACP agents only if they support HTTP servers", () => {
    expect(mcpReach("github", { type: "remote", url: "https://x.dev/mcp", enabled: true }, harnesses)).toEqual({
      receives: ["Tenon", "Codex"],
      missing: [],
      maybe: ["Claude Code"],
    })
  })

  test("a name that isn't a bare key is not forwarded to external harnesses", () => {
    expect(mcpReach("my server", { type: "local", command: ["x"], enabled: true }, harnesses)).toEqual({
      receives: ["Tenon"],
      missing: [
        { harness: "Codex", reason: "name" },
        { harness: "Claude Code", reason: "name" },
      ],
      maybe: [],
    })
  })

  test("a switched-off server reaches nobody", () => {
    expect(mcpReach("x", { type: "local", command: ["x"], enabled: false }, harnesses)).toEqual({
      receives: [],
      missing: [],
      maybe: [],
    })
  })
})

describe("AC-11 the typed form builds a real server", () => {
  test("arguments are kept as given, spaces included, with environment, folder and timeout", () => {
    expect(
      mcpEntryFromForm({
        kind: "local",
        command: "uvx",
        args: ["mcp-server-postgres", "postgresql://localhost/app db"],
        env: [
          { key: "PGPASSWORD", value: "secret" },
          { key: "", value: "ignored" },
        ],
        cwd: "~/work/app",
        timeout: "30",
      }),
    ).toEqual({
      type: "local",
      command: ["uvx", "mcp-server-postgres", "postgresql://localhost/app db"],
      environment: { PGPASSWORD: "secret" },
      cwd: "~/work/app",
      timeout: 30_000,
      enabled: true,
    })
  })

  test("a remote server takes a URL and headers", () => {
    expect(
      mcpEntryFromForm({
        kind: "remote",
        url: "https://api.example.com/mcp",
        headers: [{ key: "Authorization", value: "Bearer t" }],
      }),
    ).toEqual({
      type: "remote",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer t" },
      enabled: true,
    })
  })

  test("a missing command, a bad URL or a bad timeout is refused", () => {
    expect(mcpEntryFromForm({ kind: "local", command: " ", args: [] })).toBeUndefined()
    expect(mcpEntryFromForm({ kind: "remote", url: "ftp://x" })).toBeUndefined()
    expect(mcpEntryFromForm({ kind: "local", command: "x", args: [], timeout: "soon" })).toBeUndefined()
  })

  test("a pasted JSON server entry is accepted", () => {
    expect(mcpEntryFromForm({ kind: "json", json: '{"type":"local","command":["npx","@playwright/mcp"]}' })).toEqual({
      type: "local",
      command: ["npx", "@playwright/mcp"],
      enabled: true,
    })
    expect(mcpEntryFromForm({ kind: "json", json: '{"type":"local"}' })).toBeUndefined()
    expect(mcpEntryFromForm({ kind: "json", json: "not json" })).toBeUndefined()
  })

  test("names: empty, taken and reserved names are refused", () => {
    expect(mcpNameProblem("", ["github"])).toBe("empty")
    expect(mcpNameProblem("github", ["github"])).toBe("taken")
    expect(mcpNameProblem("tenon", [])).toBe("reserved")
    expect(mcpNameProblem("postgres", ["github"])).toBeUndefined()
  })
})

describe("AC-12 the Settings page uses one list with the fix in the row", () => {
  test("rows read live status, offer the fix and can be removed", () => {
    const source = readFileSync(join(import.meta.dir, "mcp-servers.tsx"), "utf8")
    expect(source).toContain("mcpRowState(")
    expect(source).toContain("mcpReach(")
    expect(source).toContain("removeMcpServer(")
    expect(source).toContain("mcp.toggle(")
    expect(source).not.toContain("secondBrain.mcp.removeHint")
  })
})
