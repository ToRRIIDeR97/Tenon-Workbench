import type { Harness } from "@tenon/schema/harness"

/** How often a harness picker may ask for a fresh update check while a harness is unavailable. */
export const UPDATE_CHECK_MS = 60_000

export type HarnessUpdateChoice =
  | { kind: "update"; latest: string | undefined; disabled: false }
  | { kind: "updating"; disabled: true }
  | { kind: "unavailable"; error: string | undefined; disabled: true }

/**
 * What a harness picker row offers for a harness that failed its check (#321). A stale CLI often fails the ACP
 * handshake, so an unavailable harness with a known, installable update offers Update in the row itself; otherwise
 * the row shows the first line of the failure instead of a bare "Unavailable".
 */
export function harnessUpdateChoice(
  instance: Pick<Harness.Instance, "status" | "error">,
  update: Pick<Harness.UpdateStatus, "updateAvailable" | "method" | "latest" | "manual"> | undefined,
  upgrading: boolean,
): HarnessUpdateChoice | undefined {
  if (instance.status !== "unavailable") return undefined
  if (upgrading) return { kind: "updating", disabled: true }
  // An update that needs an administrator prompt is Settings' to explain; it isn't a one-click action.
  if (update?.updateAvailable && update.method && !update.manual)
    return { kind: "update", latest: update.latest, disabled: false }
  const error = instance.error?.split("\n")[0]?.trim()
  return { kind: "unavailable", error: error || undefined, disabled: true }
}

/**
 * True when a listed harness is unavailable and the last update check is older than `UPDATE_CHECK_MS`. The list
 * holds enabled harnesses only, so a disabled one never asks.
 */
export function shouldCheckHarnessUpdates(
  instances: ReadonlyArray<Pick<Harness.Instance, "status" | "slowStart">> | undefined,
  lastCheck: number | undefined,
  now: number,
) {
  // A slow start is often an outdated CLI too, so the picker can say an update is out.
  if (!instances?.some((item) => item.status === "unavailable" || item.slowStart)) return false
  return lastCheck === undefined || now - lastCheck >= UPDATE_CHECK_MS
}
