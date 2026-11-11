import { describe, expect, test } from "bun:test"
import { checklistPassed, harnessChecklist } from "./harness-checklist"

const discovery = { command: "/opt/homebrew/bin/agent", args: ["acp"], agentName: "Agent", version: "2.0", models: [] }

describe("harnessChecklist", () => {
  test("a failed handshake fails the required rows and stops", () => {
    const rows = harnessChecklist({ stage: "done", failedAt: "discover", error: "no acp", platform: "macOS" })
    expect(rows.find((row) => row.id === "command")).toMatchObject({ status: "fail", detail: "no acp" })
    expect(rows.find((row) => row.id === "prompt")?.status).toBe("waiting")
    expect(checklistPassed(rows)).toBe(false)
  })

  test("a full pass with missing capabilities warns but can be saved", () => {
    const rows = harnessChecklist({
      stage: "done",
      discovery,
      verification: {
        ...discovery,
        reply: "harness ok",
        ok: true,
        capabilities: { mcpHttp: false, image: true, loadSession: true },
      },
      platform: "macOS",
    })
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      command: "pass",
      handshake: "pass",
      models: "warn",
      prompt: "pass",
      mcp: "warn",
      image: "pass",
      resume: "pass",
      platform: "pass",
    })
    expect(checklistPassed(rows)).toBe(true)
  })

  test("the prompt row runs while verification is in progress", () => {
    const rows = harnessChecklist({ stage: "verify", discovery, platform: "Windows" })
    expect(rows.find((row) => row.id === "prompt")?.status).toBe("running")
    expect(checklistPassed(rows)).toBe(false)
  })
})
