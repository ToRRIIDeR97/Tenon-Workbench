/**
 * Switches a thread's harness without making the user wait: a pick shows as `pending` at once, picks are sent one
 * at a time in order (picks made while one is sending collapse to the newest), and `settled` resolves once the last
 * one has been sent, so a send made meanwhile waits for it instead of being refused.
 */
export function createHarnessSwitchQueue<T>(input: {
  send: (choice: T) => Promise<unknown>
  onError?: (error: unknown) => void
  /** Called whenever `pending` changes, so a reactive owner can follow it. */
  onPending?: (choice: T | undefined) => void
}) {
  let pending: { choice: T } | undefined
  let next: { choice: T } | undefined
  let running: Promise<boolean> | undefined

  const setPending = (value: { choice: T } | undefined) => {
    pending = value
    input.onPending?.(value?.choice)
  }

  // Resolves true when the last pick reached the server, false when it failed (the pill then shows the old one).
  const drain = async () => {
    let ok = true
    while (next) {
      const current = next
      next = undefined
      ok = await input.send(current.choice).then(
        () => true,
        (error: unknown) => {
          input.onError?.(error)
          return false
        },
      )
    }
    running = undefined
    setPending(undefined)
    return ok
  }

  return {
    pending: () => pending?.choice,
    switch(choice: T) {
      next = { choice }
      setPending({ choice })
      running ??= drain()
    },
    /** Resolves once the last pick has been sent (true) or has failed (false); at once, true, with nothing pending. */
    settled: () => running ?? Promise.resolve(true),
  }
}
