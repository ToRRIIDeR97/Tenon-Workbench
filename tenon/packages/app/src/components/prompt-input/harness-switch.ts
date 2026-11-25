export function createHarnessSwitchQueue<T>(input: {
  send: (choice: T) => Promise<unknown>
  onError?: (error: unknown) => void
  onPending?: (choice: T | undefined) => void
}) {
  let pending: { choice: T } | undefined
  let next: { choice: T } | undefined
  let running: Promise<boolean> | undefined

  const setPending = (value: { choice: T } | undefined) => {
    pending = value
    input.onPending?.(value?.choice)
  }

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
    settled: () => running ?? Promise.resolve(true),
  }
}
