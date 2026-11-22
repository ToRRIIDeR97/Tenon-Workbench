import { expect, test } from "bun:test"
import { HarnessPids } from "@tenon/core/harness/pids"

test("a recorded command matches by name on both platforms", () => {
  expect(
    HarnessPids.runsCommand('"C:\\Program Files\\OpenCode\\opencode.exe" acp', "C:\\Tools\\opencode.exe", "win32"),
  ).toBe(true)
  expect(
    HarnessPids.runsCommand('"C:\\Program Files\\OpenCode\\other.exe" acp', "C:\\Tools\\opencode.exe", "win32"),
  ).toBe(false)
  expect(HarnessPids.runsCommand("powershell.exe -NoProfile", "C:\\Tools\\opencode.exe", "win32")).toBe(false)
  expect(HarnessPids.runsCommand("/usr/local/bin/opencode acp", "/opt/opencode", "linux")).toBe(true)
  expect(HarnessPids.runsCommand("/usr/local/bin/codex app-server", "/opt/opencode", "linux")).toBe(false)
  expect(HarnessPids.runsCommand("", "/opt/opencode", "linux")).toBe(false)
})

test("reaps only the recorded processes that still run their command", async () => {
  const killed: number[] = []
  const entries = [
    { pid: 11, command: "opencode" },
    { pid: 12, command: "codex" },
  ]
  const ended = await HarnessPids.reap(
    entries,
    async (pid) => pid === 11,
    (pid) => killed.push(pid),
  )
  expect(ended).toEqual([11])
  expect(killed).toEqual([11])
})
