export type UndoAction = {
  title: string
  description?: string
  undo: () => unknown
  commit?: () => unknown
}

export type UndoQueueOptions = {
  duration?: number
  show: (action: UndoAction, undo: () => void) => number
  dismiss: (toastId: number) => void
  onChange?: (pending: number) => void
  onError?: (cause: unknown) => void
  schedule?: (run: () => void, ms: number) => () => void
}

export const UNDO_DURATION = 5_000

type Entry = { action: UndoAction; toastId: number; cancel: () => void }

export function createUndoQueue(options: UndoQueueOptions) {
  const duration = options.duration ?? UNDO_DURATION
  const schedule =
    options.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    })
  const entries: Entry[] = []

  const run = (fn: (() => unknown) | undefined) => {
    if (!fn) return
    try {
      void Promise.resolve(fn()).catch((cause) => options.onError?.(cause))
    } catch (cause) {
      options.onError?.(cause)
    }
  }

  const settle = (entry: Entry, mode: "undo" | "commit") => {
    const index = entries.indexOf(entry)
    if (index === -1) return false
    entries.splice(index, 1)
    entry.cancel()
    options.dismiss(entry.toastId)
    options.onChange?.(entries.length)
    run(mode === "undo" ? entry.action.undo : entry.action.commit)
    return true
  }

  return {
    push(action: UndoAction) {
      const entry: Entry = { action, toastId: 0, cancel: () => {} }
      entries.push(entry)
      entry.toastId = options.show(action, () => settle(entry, "undo"))
      entry.cancel = schedule(() => settle(entry, "commit"), duration)
      options.onChange?.(entries.length)
    },
    undoLatest() {
      const entry = entries.at(-1)
      return entry ? settle(entry, "undo") : false
    },
    flush() {
      while (entries[0]) settle(entries[0], "commit")
    },
    pending: () => entries.length,
  }
}

export type UndoQueue = ReturnType<typeof createUndoQueue>
