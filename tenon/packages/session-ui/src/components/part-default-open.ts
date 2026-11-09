import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"
import { stepOf } from "./step-kind"

function deletionOnly(part: ToolPart) {
  if (!("metadata" in part.state)) return false
  const metadata = part.state.metadata
  if (!metadata) return false

  const files = metadata.files
  if (Array.isArray(files) && files.length > 0) {
    return files.every((file) => !!file && typeof file === "object" && "type" in file && file.type === "delete")
  }

  const filediff = metadata.filediff
  if (!filediff || typeof filediff !== "object") return false
  if (!("additions" in filediff) || !("deletions" in filediff)) return false
  return filediff.additions === 0 && typeof filediff.deletions === "number" && filediff.deletions > 0
}

export function partDefaultOpen(part: PartType, shell = false, edit = false) {
  if (part.type !== "tool") return
  // By step kind, so Codex and ACP commands and edits (`command_execution`, `acp_execute`, `acp_edit`, …) follow the
  // settings too. Searches, reads and every other tool start closed.
  const kind = stepOf(part).kind
  if (kind === "run") return shell
  if (kind === "edit") {
    if (!edit) return false
    return !deletionOnly(part)
  }
}
