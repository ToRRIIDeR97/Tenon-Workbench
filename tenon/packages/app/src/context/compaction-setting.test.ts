import { describe, expect, test } from "bun:test"
import { compactionModel, DEFAULT_COLD_MINUTES } from "./settings"

describe("compactionModel", () => {
  const setting = { model: "haiku", coldMinutes: DEFAULT_COLD_MINUTES }

  test("a thread idle past the cold limit compacts on the harness's compaction model", () => {
    expect(compactionModel(setting, 29)).toEqual({ id: "haiku" })
    expect(compactionModel({ ...setting, reasoningEffort: "low" }, 90)).toEqual({ id: "haiku", reasoningEffort: "low" })
  })

  test("a warm thread, or a harness with no compaction model, compacts on its own model", () => {
    expect(compactionModel(setting, 28.9)).toBeUndefined()
    expect(compactionModel(undefined, 600)).toBeUndefined()
    expect(compactionModel({ coldMinutes: 5 }, 600)).toBeUndefined()
  })
})
