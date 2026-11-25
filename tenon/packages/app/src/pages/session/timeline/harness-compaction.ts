type Reply = { id: string; parentID?: string; role: string; harnessInstanceID?: string; contextUsed?: number }

const TENON = "opencode"
const MIN_BEFORE = 20_000
const MAX_KEPT = 0.6
const MIN_DROP = 15_000

export type ObservedCompaction = { harness: string; before: number; after: number }

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
