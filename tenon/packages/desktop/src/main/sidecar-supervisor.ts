export type SupervisedSidecar = {
  ready: Promise<void>
  exited: Promise<number>
  stop: () => Promise<void>
}

const INITIAL_DELAY = 1_000
const MAX_DELAY = 30_000
const MAX_RESTARTS = 5
const RESTART_WINDOW = 10 * 60_000

export function restartDelay(recentRestarts: number) {
  return Math.min(MAX_DELAY, INITIAL_DELAY * 2 ** recentRestarts)
}

export function superviseSidecar<T extends SupervisedSidecar>(input: {
  spawn: () => T
  log: (message: string, meta?: Record<string, unknown>) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  hold?: () => Promise<() => Promise<void>>
}) {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = input.now ?? Date.now
  const initial = input.spawn()
  let current: SupervisedSidecar = initial
  let stopped = false
  let restarts: number[] = []

  const watch = (sidecar: SupervisedSidecar, restarted: boolean) =>
    void sidecar.ready.then(
      () => {
        if (restarted) input.log("sidecar restarted")
        void sidecar.exited.then((code) => {
          if (stopped || sidecar !== current) return
          input.log("sidecar exited unexpectedly", { code })
          void restart()
        })
      },
      (error) => {
        if (!restarted || stopped || sidecar !== current) return
        input.log("sidecar restart failed", { error: error instanceof Error ? error.message : String(error) })
        void restart()
      },
    )

  let held: (() => Promise<void>) | undefined
  const release = async () => {
    const free = held
    held = undefined
    await free?.().catch((error: unknown) =>
      input.log("sidecar port release failed", { error: error instanceof Error ? error.message : String(error) }),
    )
  }

  const restart = async () => {
    if (!held && input.hold)
      held = await input.hold().catch((error: unknown) => {
        input.log("sidecar port hold failed", { error: error instanceof Error ? error.message : String(error) })
        return undefined
      })
    if (stopped) return release()
    const time = now()
    restarts = restarts.filter((at) => time - at < RESTART_WINDOW)
    if (restarts.length >= MAX_RESTARTS) {
      input.log("sidecar restart limit reached", { restarts: restarts.length })
      return
    }
    const delay = restartDelay(restarts.length)
    restarts.push(time)
    await sleep(delay)
    if (stopped) return release()
    input.log("restarting sidecar", { attempt: restarts.length, delay })
    await release()
    if (stopped) return
    current = input.spawn()
    watch(current, true)
  }

  watch(initial, false)

  return {
    initial,
    stop: () => {
      stopped = true
      return Promise.all([current.stop(), release()]).then(() => undefined)
    },
  }
}
