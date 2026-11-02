import type { ToolPart } from "@opencode-ai/sdk/v2"
import { normalize, type ViewDiff } from "@tenon/session-ui/session-diff"
import { stepOf } from "@tenon/session-ui/step-kind"

type Source = { file?: string; patch?: string; before?: string; after?: string; additions?: number; deletions?: number }

const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const count = (value: unknown) => (typeof value === "number" ? value : undefined)
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

/**
 * The file changes an edit step made, one per file, for the steps card to draw as diffs. Built-in edits carry
 * `metadata.filediff`, patches `metadata.files`, and a harness edit its old and new text; a write is a new file.
 * Counts the harness didn't report are taken from the diff itself.
 */
export function editDiffs(part: ToolPart): ViewDiff[] {
  if (stepOf(part).kind !== "edit" || part.state.status !== "completed") return []
  const metadata = record(part.state.metadata)
  const input = record(part.state.input)
  const filePath = text(input.filePath) ?? text(input.path)
  const sources: Source[] = Array.isArray(metadata.files)
    ? metadata.files.map((item) => {
        const file = record(item)
        return {
          file: text(file.relativePath) ?? text(file.filePath) ?? text(file.file),
          patch: text(file.patch) ?? text(file.diff),
          before: text(file.before),
          after: text(file.after),
          additions: count(file.additions),
          deletions: count(file.deletions),
        }
      })
    : metadata.filediff
      ? [
          {
            file: text(record(metadata.filediff).file) ?? filePath,
            patch: text(record(metadata.filediff).patch),
            before: text(record(metadata.filediff).before) ?? text(input.oldString),
            after: text(record(metadata.filediff).after) ?? text(input.newString),
            additions: count(record(metadata.filediff).additions),
            deletions: count(record(metadata.filediff).deletions),
          },
        ]
      : [
          {
            file: filePath,
            before: text(input.oldString) ?? (text(input.content) === undefined ? undefined : ""),
            after: text(input.newString) ?? text(input.content),
          },
        ]
  return sources.flatMap((source) => {
    const file = source.file
    if (!file || (source.patch === undefined && source.before === undefined && source.after === undefined)) return []
    try {
      const view = normalize({ ...source, file, additions: source.additions ?? 0, deletions: source.deletions ?? 0 })
      const hunks = view.fileDiff.hunks
      return [
        {
          ...view,
          additions: source.additions ?? hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
          deletions: source.deletions ?? hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
        },
      ]
    } catch {
      return []
    }
  })
}
