import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { liveSubagents } from "./environment-model"

describe("AC-14 liveSubagents", () => {
  test("keeps running and pending subagents, drops finished and failed ones", () => {
    const rows = [
      { id: "a", status: "completed" },
      { id: "b", status: "running" },
      { id: "c", status: "error" },
      { id: "d", status: "pending" },
    ]
    expect(liveSubagents(rows).map((row) => row.id)).toEqual(["b", "d"])
  })
})

describe("AC-14 Environment rows", () => {
  const source = readFileSync(join(import.meta.dir, "..", "session", "thread-environment.tsx"), "utf8")
  test("the Running section lists live subagents only", () => {
    expect(source).toContain("liveSubagents(")
  })
  test("opening a subagent closes the window", () => {
    const click = source.slice(source.indexOf("data.openSubagent?.({ sessionID: row.sessionID"))
    expect(click.slice(0, 200)).toContain("props.onClose()")
  })
})
