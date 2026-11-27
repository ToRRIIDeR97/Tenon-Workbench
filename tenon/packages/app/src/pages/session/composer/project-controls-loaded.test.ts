import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

describe("new-thread project picker loading", () => {
  test("the project list is read from the query cache, never through the suspending data getter", () => {
    const source = readFileSync(path.join(import.meta.dir, "session-composer-controls.ts"), "utf8")
    const controls = source.slice(source.indexOf("export function createPromptProjectControls"))
    expect(controls).toContain("cachedQueryData<NonNullable<typeof projectThreads.data>>(")
    expect(controls).toContain("projectThreadsQueryKey(server.key, brain)")
    expect(controls).not.toMatch(/projectThreads\.data\s*:/)
    expect(controls).not.toMatch(/\?\s*projectThreads\.data\b/)
  })
})
