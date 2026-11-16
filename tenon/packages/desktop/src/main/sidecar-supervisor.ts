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

/**
 * Restarts a sidecar that exits after it became ready, with exponential backoff and at most
 * MAX_RESTARTS attempts per RESTART_WINDOW. A failure of the first start is left to the caller.
 */
export function superviseSidecar<T extends SupervisedSidecar>(input: {
  spawn: () => T
  log: (message: string, meta?: Record<string, unknown>) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /**
   * Holds the sidecar's port while it is down, so no other local process can bind it and receive the
   * renderers' credential and traffic during the backoff (#164). Resolves to the release, called just before
   * the respawn binds the port again; a hold that fails is skipped.
   */
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

  // The port's hold while the sidecar is down; released before a respawn or when the supervisor stops.
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
      // The hold stays: renderers keep reaching a closed door instead of whatever binds the port next.
      input.log("sidecar restart limit reached", { restarts: restarts.length })
      return
    }
    const delay = restartDelay(restarts.length)
    restarts.push(time)
    await sleep(delay)
    if (stopped) return release()
    input.log("restarting sidecar", { attempt: restarts.length, delay })
    await release()
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
