import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { CommandMemory } from "../../src/agents/command-memory"
import COMMAND_AGENT from "../../src/agents/command-agent.md" with { type: "text" }

const withFolder = async (run: (folder: string, file: string) => Promise<void>) => {
  const folder = await mkdtemp(path.join(tmpdir(), "command-agent-"))
  await run(folder, path.join(folder, "AGENTS.md")).finally(() => rm(folder, { recursive: true, force: true }))
}

describe("Command Centre agent instructions", () => {
  test("the instructions say what the agent is for and never send email", () => {
    expect(COMMAND_AGENT.startsWith("<!-- Managed by Tenon Workbench")).toBe(true)
    expect(COMMAND_AGENT).toContain("# Command Centre agent")
    expect(COMMAND_AGENT).toContain("Never send email")
  })

  test("writes AGENTS.md into a new Command Centre folder", () =>
    withFolder(async (folder, file) => {
      await CommandMemory.writeInstructions(folder)
      expect(await readFile(file, "utf8")).toBe(COMMAND_AGENT)
    }))

  test("refreshes an older managed copy", () =>
    withFolder(async (folder, file) => {
      await writeFile(file, "<!-- Managed by Tenon Workbench and refreshed on update. -->\n\n# Old text\n")
      await CommandMemory.writeInstructions(folder)
      expect(await readFile(file, "utf8")).toBe(COMMAND_AGENT)
    }))

  test("leaves a file the user took over", () =>
    withFolder(async (folder, file) => {
      await writeFile(file, "# My own Command Centre rules\n")
      await CommandMemory.writeInstructions(folder)
      expect(await readFile(file, "utf8")).toBe("# My own Command Centre rules\n")
    }))
})
