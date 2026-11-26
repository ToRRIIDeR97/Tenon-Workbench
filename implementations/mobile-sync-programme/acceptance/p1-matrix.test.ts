import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const matrixPath = path.join(root, "docs/records/feature-test-matrix.md")
const header = ["ID", "Area", "Feature", "Source", "Coverage", "Evidence", "Status", "Notes"]
const coverages = ["unit", "e2e", "unit+e2e", "none"]
const statuses = ["covered", "gap", "manual", "blocked"]

function cells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
}

function ticked(cell: string) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1])
}

function readMatrix() {
  const lines = readFileSync(matrixPath, "utf8").split(/\r?\n/)
  const tables = lines.flatMap((line, index) =>
    line.trim().startsWith("|") && !lines[index - 1]?.trim().startsWith("|") ? [cells(line)] : [],
  )
  const rows = lines
    .filter((line) => /^\|\s*F-\d/.test(line))
    .map(cells)
    .map((row) => ({
      id: row[0],
      area: row[1],
      feature: row[2],
      sources: ticked(row[3] ?? ""),
      coverage: row[4],
      evidence: ticked(row[5] ?? ""),
      status: row[6],
      notes: row[7] ?? "",
      width: row.length,
    }))
  return { tables, rows }
}

function source(file: string) {
  return readFileSync(path.join(root, file), "utf8")
}

function missing(wanted: string[]) {
  const cited = new Set(readMatrix().rows.flatMap((row) => row.sources))
  return wanted.filter((item) => !cited.has(item))
}

describe("P1 feature test matrix", () => {
  test("AC-P1-1 the matrix exists and every table has the agreed header", () => {
    expect(existsSync(matrixPath)).toBe(true)
    const matrix = readMatrix()
    expect(matrix.tables.length).toBeGreaterThan(0)
    expect(matrix.tables.filter((table) => table.join("|") !== header.join("|"))).toEqual([])
    expect(matrix.rows.length).toBeGreaterThan(40)
    expect(matrix.rows.filter((row) => row.width !== header.length).map((row) => row.id)).toEqual([])
  })

  test("AC-P1-1 IDs are well formed and unique", () => {
    const ids = readMatrix().rows.map((row) => row.id)
    expect(ids.filter((id) => !/^F-\d{3,}$/.test(id))).toEqual([])
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  test("AC-P1-1 coverage and status use only the listed words", () => {
    const rows = readMatrix().rows
    expect(rows.filter((row) => !coverages.includes(row.coverage)).map((row) => row.id)).toEqual([])
    expect(rows.filter((row) => !statuses.includes(row.status)).map((row) => row.id)).toEqual([])
  })

  test("AC-P1-2 rows without coverage are gap, manual or blocked", () => {
    const rows = readMatrix().rows
    expect(rows.filter((row) => row.coverage === "none" && row.status === "covered").map((row) => row.id)).toEqual([])
  })

  test("AC-P1-2 covered rows cite test files that exist", () => {
    const rows = readMatrix().rows
    expect(rows.filter((row) => row.coverage !== "none" && row.evidence.length === 0).map((row) => row.id)).toEqual([])
    const absent = rows.flatMap((row) =>
      row.evidence
        .filter((file) => !existsSync(path.join(root, file)) || !statSync(path.join(root, file)).isFile())
        .map((file) => `${row.id}: ${file}`),
    )
    expect(absent).toEqual([])
  })

  test("AC-P1-3 every literal app route is cited", () => {
    const routes = [...source("tenon/packages/app/src/app.tsx").matchAll(/<Route\s+path="([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(routes.length).toBeGreaterThan(10)
    expect(missing(routes)).toEqual([])
  })

  test("AC-P1-4 every IPC channel is cited", () => {
    const channels = [
      ...source("tenon/packages/desktop/src/main/ipc.ts").matchAll(
        /(?:trustedHandle|trustedOn|ipcMain\.handle|ipcMain\.on)\(\s*"([^"]+)"/g,
      ),
    ].map((match) => match[1])
    expect(channels.length).toBeGreaterThan(100)
    expect(missing([...new Set(channels)])).toEqual([])
  })

  test("AC-P1-5 every browser and device tool is cited", () => {
    const tools = [...source("tenon/packages/core/src/harness/browser-tools.ts").matchAll(/^\s+name: "([a-z_]+)"/gm)].map(
      (match) => match[1],
    )
    expect(tools.length).toBeGreaterThan(10)
    expect(missing(tools)).toEqual([])
  })
})
