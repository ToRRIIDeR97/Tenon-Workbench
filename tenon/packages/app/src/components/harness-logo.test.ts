import { describe, expect, test } from "bun:test"
import { harnessLogo } from "./harness-logo"

describe("harnessLogo", () => {
  test("the built-in agent shows the Tenon mark and the built-ins their makers' logos", () => {
    expect(harnessLogo({ id: "opencode", name: "Default agent" })).toEqual({ kind: "tenon" })
    expect(harnessLogo({ id: "codex", name: "Codex" })).toEqual({ kind: "provider", id: "openai" })
    expect(harnessLogo({ id: "claude-code", name: "Claude Code" })).toEqual({ kind: "provider", id: "anthropic" })
    expect(harnessLogo({ id: "opencode-acp", name: "OpenCode" })).toEqual({ kind: "provider", id: "opencode" })
  })

  test("a registered agent is known by its name, or shows its first letter", () => {
    expect(harnessLogo({ id: "my-gemini", name: "Gemini CLI" })).toEqual({ kind: "provider", id: "google" })
    expect(harnessLogo({ id: "command-code", name: "Command Code" })).toEqual({ kind: "letter", letter: "C" })
    expect(harnessLogo({ id: "x", name: "  " })).toEqual({ kind: "letter", letter: "?" })
  })
})
