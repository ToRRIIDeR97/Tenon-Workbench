import type { UndoState } from "@/features/agent-writes/store"

export type TurnDiff = {
  file?: string
  patch?: string
  status?: "added" | "deleted" | "modified"
  additions: number
  deletions: number
}

export type TurnWrite = { id: string; undo?: string; undoState: UndoState; failed: boolean; phase: "started" | "done" }

export type TurnFileChange = { file: string; patch: string; status: "added" | "deleted" | "modified" }

export type TurnUndoPlan = { files: TurnFileChange[]; skipped: string[]; writes: string[]; empty: boolean }

export type FileRevertResult = { file: string; result: "reverted" | "changed" | "failed" }

export function folderPrefix(worktree: string | undefined, directory: string) {
  const clean = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!worktree || clean(worktree) === "") return ""
  const root = clean(worktree)
  const folder = clean(directory)
  const windows = /^[A-Za-z]:/.test(root)
  const same = (left: string, right: string) => (windows ? left.toLowerCase() === right.toLowerCase() : left === right)
  if (same(root, folder) || !same(folder.slice(0, root.length + 1), `${root}/`)) return ""
  return `${folder.slice(root.length + 1)}/`
}

export function turnUndoPlan(input: {
  diffs: ReadonlyArray<TurnDiff>
  writes: ReadonlyArray<TurnWrite>
  prefix?: string
}): TurnUndoPlan {
  const prefix = input.prefix ?? ""
  const byFile = new Map<string, TurnDiff>()
  for (const diff of input.diffs) if (diff.file) byFile.set(diff.file, diff)
  const files: TurnFileChange[] = []
  const skipped: string[] = []
  for (const [file, diff] of byFile) {
    if (!diff.patch || !file.startsWith(prefix)) skipped.push(file)
    else files.push({ file: file.slice(prefix.length), patch: diff.patch, status: diff.status ?? "modified" })
  }
  const writes = input.writes
    .filter((write) => write.undo && write.phase === "done" && !write.failed && write.undoState === "idle")
    .map((write) => write.id)
  return { files, skipped, writes, empty: files.length === 0 && writes.length === 0 }
}

export function turnUndoSummary(files: ReadonlyArray<FileRevertResult>, writes: ReadonlyArray<UndoState>) {
  const count = (result: string) =>
    files.filter((item) => item.result === result).length + writes.filter((state) => state === result).length
  return {
    reverted:
      files.filter((item) => item.result === "reverted").length + writes.filter((state) => state === "undone").length,
    changed: count("changed"),
    failed: count("failed"),
  }
}
