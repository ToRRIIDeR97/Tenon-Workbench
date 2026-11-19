type Reply = { id: string; parentID?: string; role: string; harnessInstanceID?: string; contextUsed?: number }

/** The built-in agent compacts in Tenon and has its own divider; every other harness compacts on its own. */
const TENON = "opencode"
/** A drop counts as a compaction only from a context this large, by at least this share and this many tokens. */
const MIN_BEFORE = 20_000
const MAX_KEPT = 0.6
const MIN_DROP = 15_000

export type ObservedCompaction = { harness: string; before: number; after: number }

/**
 * External harnesses compact inside their own process and don't say so (#332). Tenon sees it only as the context in
 * use falling sharply between two replies of the same harness. Returns, by user message ID, the turns that start
 * after such a drop, with the two figures, so the thread can show an "observed" divider.
 */
export function observedCompactions(messages: ReadonlyArray<Reply>) {
  const found = new Map<string, ObservedCompaction>()
  const last = new Map<string, number>()
  for (const message of messages) {
    const harness = message.harnessInstanceID
    const used = message.contextUsed
    if (message.role !== "assistant" || !harness || harness === TENON || !used || used <= 0) continue
    const before = last.get(harness)
    last.set(harness, used)
    if (before === undefined || !message.parentID) continue
    if (before >= MIN_BEFORE && used <= before * MAX_KEPT && before - used >= MIN_DROP && !found.has(message.parentID))
      found.set(message.parentID, { harness, before, after: used })
  }
  return found
}
