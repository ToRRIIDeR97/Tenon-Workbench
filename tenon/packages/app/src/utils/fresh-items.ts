export function createFreshItems() {
  const seen = new Set<string>()
  const state = { ready: false, arming: false }
  return (id: string) => {
    const fresh = state.ready && !seen.has(id)
    seen.add(id)
    if (!state.ready && !state.arming) {
      state.arming = true
      queueMicrotask(() => (state.ready = true))
    }
    return fresh
  }
}
