import type { Harness } from "@tenon/schema/harness"

export const UPDATE_CHECK_MS = 60_000

export type HarnessUpdateChoice =
  | { kind: "update"; latest: string | undefined; disabled: false }
  | { kind: "updating"; disabled: true }
  | { kind: "unavailable"; error: string | undefined; disabled: true }

export function harnessUpdateChoice(
  instance: Pick<Harness.Instance, "status" | "error">,
  update: Pick<Harness.UpdateStatus, "updateAvailable" | "method" | "latest" | "manual"> | undefined,
  upgrading: boolean,
): HarnessUpdateChoice | undefined {
  if (instance.status !== "unavailable") return undefined
  if (upgrading) return { kind: "updating", disabled: true }
  if (update?.updateAvailable && update.method && !update.manual)
    return { kind: "update", latest: update.latest, disabled: false }
  const error = instance.error?.split("\n")[0]?.trim()
  return { kind: "unavailable", error: error || undefined, disabled: true }
}

export function shouldCheckHarnessUpdates(
  instances: ReadonlyArray<Pick<Harness.Instance, "status" | "slowStart">> | undefined,
  lastCheck: number | undefined,
  now: number,
) {
  if (!instances?.some((item) => item.status === "unavailable" || item.slowStart)) return false
  return lastCheck === undefined || now - lastCheck >= UPDATE_CHECK_MS
}
