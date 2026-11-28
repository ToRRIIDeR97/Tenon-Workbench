export * as FileRevert from "./revert"

import { applyPatch, parsePatch, reversePatch, structuredPatch, type StructuredPatch } from "diff"

export type Status = "added" | "deleted" | "modified"

export type Change = { status?: Status; patch: string; current: string | undefined }

export type Outcome =
  | { kind: "write"; content: string }
  | { kind: "create"; content: string }
  | { kind: "remove" }
  | { kind: "none" }
  | { kind: "changed" }

const CONTEXT = 3

function parse(patch: string): StructuredPatch | undefined {
  try {
    const parsed = parsePatch(patch)
    const first = parsed[0]
    return parsed.length === 1 && first && first.hunks.length > 0 ? first : undefined
  } catch {
    return undefined
  }
}

function side(patch: StructuredPatch, keep: "-" | "+") {
  const hunk = patch.hunks[0]
  if (!hunk || patch.hunks.length !== 1 || hunk.oldStart > 1 || hunk.newStart > 1) return undefined
  const lines: string[] = []
  let previous: string | undefined
  let newline = true
  for (const line of hunk.lines) {
    const mark = line[0]
    if (mark === "\\") {
      if (previous === " " || previous === keep) newline = false
      continue
    }
    previous = mark
    if (mark === " " || mark === keep) lines.push(line.slice(1))
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}${newline ? "\n" : ""}`
}

function apply(source: string, patch: StructuredPatch) {
  try {
    const result = applyPatch(source, patch)
    return result === false ? undefined : result
  } catch {
    return undefined
  }
}

function reverseModified(current: string, patch: StructuredPatch) {
  const direct = apply(current, reversePatch(patch))
  if (direct !== undefined) return direct
  const before = side(patch, "-")
  const after = side(patch, "+")
  if (before === undefined || after === undefined) return undefined
  const narrow = structuredPatch("a", "b", before, after, "", "", { context: CONTEXT })
  if (narrow.hunks.length === 0) return current === after ? before : undefined
  return apply(current, reversePatch(narrow))
}

const same = (left: string, right: string) => left.trim() === right.trim()

export function revertFileChange(change: Change): Outcome {
  const patch = parse(change.patch)
  if (!patch) return { kind: "changed" }
  const status = change.status ?? "modified"
  if (status === "added") {
    if (change.current === undefined) return { kind: "none" }
    const after = apply("", patch) ?? side(patch, "+")
    return after !== undefined && same(change.current, after) ? { kind: "remove" } : { kind: "changed" }
  }
  if (status === "deleted") {
    if (change.current !== undefined) return { kind: "changed" }
    const before = apply("", reversePatch(patch)) ?? side(patch, "-")
    return before === undefined ? { kind: "changed" } : { kind: "create", content: before }
  }
  if (change.current === undefined) return { kind: "changed" }
  const before = reverseModified(change.current, patch)
  return before === undefined ? { kind: "changed" } : { kind: "write", content: before }
}
