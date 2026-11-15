import { describe, expect, test } from "bun:test"
import { changeTotals, connectorRows, runningSubagents, shortFolder } from "./environment-model"

describe("shortFolder", () => {
  test("puts ~ for the home folder on Windows and macOS paths", () => {
    expect(shortFolder("C:\\Users\\sense\\OneDrive\\Desktop\\Brain", "C:\\Users\\sense")).toBe(
      "~/OneDrive/Desktop/Brain",
    )
    expect(shortFolder("/Users/nat/code/app/", "/Users/nat")).toBe("~/code/app")
    expect(shortFolder("D:\\work\\repo", "C:\\Users\\sense")).toBe("D:/work/repo")
    expect(shortFolder(undefined, "/Users/nat")).toBe("")
  })
})

describe("changeTotals", () => {
  test("counts files and lines", () => {
    expect(
      changeTotals([
        { additions: 64, deletions: 0 },
        { additions: 22, deletions: 31 },
      ]),
    ).toEqual({ files: 2, additions: 86, deletions: 31 })
    expect(changeTotals(undefined)).toEqual({ files: 0, additions: 0, deletions: 0 })
  })
})

describe("connectorRows", () => {
  const config = {
    zeta: { type: "remote", enabled: false },
    github: { type: "local" },
    toggleOnly: { enabled: true },
  }
  test("lists the user's servers, on or off, skipping toggle-only entries", () => {
    expect(connectorRows(config, false)).toEqual([
      { name: "github", on: true, builtIn: false },
      { name: "zeta", on: false, builtIn: false },
    ])
  })
  test("adds Tenon's own server first for Codex and ACP agents", () => {
    expect(connectorRows(config, true)[0]).toEqual({ name: "tenon", on: true, builtIn: true })
    expect(connectorRows(undefined, true)).toEqual([{ name: "tenon", on: true, builtIn: true }])
  })
})

describe("runningSubagents", () => {
  const item = (status: string) => ({ part: { state: { status } } }) as never
  test("counts pending and running subagents only", () => {
    expect(
      runningSubagents([
        { turn: 1, userMessageID: "m1", items: [item("running"), item("completed")] },
        { turn: 2, userMessageID: "m2", items: [item("pending"), item("error")] },
      ] as never),
    ).toBe(2)
  })
})
