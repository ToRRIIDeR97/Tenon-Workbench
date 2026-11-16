/**
 * The live document: the files the agent is writing or editing, read from the session's tool parts
 * (the healed input while a call streams), and which Markdown blocks changed when one finishes.
 */

export type LiveWrite = {
  callID: string
  tool: "write" | "edit"
  path: string
  status: "streaming" | "running" | "completed" | "error"
  content?: string
  oldString?: string
  newString?: string
}

type ToolPartLike = {
  type: string
  tool?: string
  callID?: string
  state?: { status: string; input?: Readonly<Record<string, unknown>> }
}

const statuses: Record<string, LiveWrite["status"]> = {
  pending: "streaming",
  running: "running",
  completed: "completed",
  error: "error",
}

/** Every `write` and `edit` call with a path, in order. */
export function liveWrites(parts: readonly ToolPartLike[]): LiveWrite[] {
  return parts.flatMap((part): LiveWrite[] => {
    const input = part.state?.input
    const status = statuses[part.state?.status ?? ""]
    if (part.type !== "tool" || (part.tool !== "write" && part.tool !== "edit") || !part.callID) return []
    if (!input || typeof input.filePath !== "string" || !status) return []
    const text = (key: string) => {
      const value = input[key]
      return typeof value === "string" ? { [key]: value } : {}
    }
    return [
      {
        callID: part.callID,
        tool: part.tool,
        path: input.filePath,
        status,
        ...(part.tool === "write" ? text("content") : { ...text("oldString"), ...text("newString") }),
      },
    ]
  })
}

/** Blocks separated by blank lines; a fenced code block (closed or not) stays one block. */
export function markdownBlocks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const state = { blocks: [] as string[], current: [] as string[], fence: "" }
  lines.forEach((line) => {
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1]
    if (state.fence) {
      state.current.push(line)
      if (mark && mark[0] === state.fence[0] && mark.length >= state.fence.length && !line.trim().slice(mark.length))
        state.fence = ""
      return
    }
    if (mark) {
      state.fence = mark
      state.current.push(line)
      return
    }
    if (!line.trim()) {
      if (state.current.length) state.blocks.push(state.current.join("\n"))
      state.current = []
      return
    }
    state.current.push(line)
  })
  if (state.current.length) state.blocks.push(state.current.join("\n"))
  return state.blocks
}

/**
 * Indexes of the blocks of `after` that are new or changed against `before` (a longest-common-
 * subsequence diff of blocks). Nothing when there was no `before`, or when most of the file changed.
 */
export function changedBlocks(before: string, after: string): number[] {
  if (!before.trim()) return []
  const left = markdownBlocks(before)
  const right = markdownBlocks(after)
  // lengths[i][j]: the common subsequence of left[i..] and right[j..].
  const lengths = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0))
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      lengths[i][j] = left[i] === right[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
  const kept = new Set<number>()
  const walk = { i: 0, j: 0 }
  while (walk.i < left.length && walk.j < right.length) {
    if (left[walk.i] === right[walk.j]) {
      kept.add(walk.j)
      walk.i += 1
      walk.j += 1
      continue
    }
    if (lengths[walk.i + 1][walk.j] >= lengths[walk.i][walk.j + 1]) {
      walk.i += 1
      continue
    }
    walk.j += 1
  }
  const changed = right.map((_, index) => index).filter((index) => !kept.has(index))
  return changed.length * 2 > right.length ? [] : changed
}

/** The text of a file while an `edit` streams: the last loaded text with the old string replaced so far. */
export function editPreview(text: string, oldString: string | undefined, newString: string | undefined) {
  if (!oldString || newString === undefined || !text.includes(oldString)) return text
  return text.replace(oldString, () => newString)
}

/**
 * The texts a file view has shown, in order, so a call's "before" text comes from when the call began
 * rather than being read after a reload (the watcher's, or another call's) already replaced it.
 * `mark()` names the current moment; `at(mark)` is the text shown then or, when nothing was loaded
 * then, the first text loaded after it. `forget(mark)` drops what no later `at(mark or later)` needs.
 */
export function shownTexts() {
  const state = { tick: 0, entries: [] as { tick: number; text: string }[] }
  return {
    show(text: string) {
      if (state.entries.at(-1)?.text === text) return
      state.tick += 1
      state.entries.push({ tick: state.tick, text })
    },
    mark: () => state.tick,
    at(mark: number) {
      const then = state.entries.findLast((entry) => entry.tick <= mark)?.text
      if (then) return then
      return state.entries.find((entry) => entry.tick > mark && entry.text)?.text ?? ""
    },
    forget(mark: number) {
      const keep = state.entries.findLastIndex((entry) => entry.tick <= mark)
      if (keep > 0) state.entries.splice(0, keep)
    },
  }
}

/**
 * Whether a finished call happened while the view watched rather than in history: it was seen pending
 * or running here, its reply is still in progress, or its message is newer than the newest message the
 * view knew when it first saw the thread's messages (server times on both sides, no client clock).
 */
export function isLiveCall(call: { seen: boolean; ongoing: boolean; created: number; newest: number | undefined }) {
  return call.seen || call.ongoing || (call.newest !== undefined && call.created > call.newest)
}
