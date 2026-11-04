/**
 * Decides whether a window may unload while its page reports unsaved edits. Windows report through IPC, because the
 * main process has to ask before a quit stops the server, not when a page finally refuses to close.
 */
export function createUnloadGuard<W extends object>(input: {
  windows: () => W[]
  /** Shows the Leave or Stay prompt; true means leave. */
  ask: (win: W) => boolean
}) {
  const unsaved = new WeakSet<W>()
  // Once someone chose to leave, or for a shutdown that cannot wait on a dialog, nothing asks again.
  let allowed = false

  return {
    setUnsaved(win: W, value: boolean) {
      if (value) unsaved.add(win)
      else unsaved.delete(win)
    },
    allow() {
      allowed = true
    },
    reset() {
      allowed = false
    },
    /** A window's own close: its page already refused, so only the answer is left. */
    leave(win: W) {
      return allowed || input.ask(win)
    },
    /** One prompt covers every window; after it, the windows close without asking. */
    confirmQuit() {
      if (allowed) return true
      const win = input.windows().find((item) => unsaved.has(item))
      if (win && !input.ask(win)) return false
      allowed = true
      return true
    },
  }
}
