export function createUnloadGuard<W extends object>(input: { windows: () => W[]; ask: (win: W) => boolean }) {
  const unsaved = new WeakSet<W>()
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
    leave(win: W) {
      return allowed || input.ask(win)
    },
    confirmQuit() {
      if (allowed) return true
      const win = input.windows().find((item) => unsaved.has(item))
      if (win && !input.ask(win)) return false
      allowed = true
      return true
    },
  }
}
