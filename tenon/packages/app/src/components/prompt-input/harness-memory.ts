import { Harness } from "@tenon/schema/harness"

// A check that fails while the server starts is retried quickly at first, then less often, but never given up:
// a composer must not stay on "checking" until the page is reopened.
const FAST_RETRIES = 10
const FAST_RETRY_MS = 3_000
const SLOW_RETRY_MS = 15_000

/** How long to wait before retrying the harness list after `failures` failed checks in a row. */
export function harnessRetryDelay(failures: number) {
  return failures < FAST_RETRIES ? FAST_RETRY_MS : SLOW_RETRY_MS
}

/**
 * The harness list with the models each available agent listed last time filled in where the agent has not listed
 * them yet (it answers before its models, and a newly picked agent may still be starting). The picker then offers
 * the previous models at once instead of "Loading models…"; the real list replaces them when it arrives.
 */
export function withRememberedModels(
  fresh: ReadonlyArray<Harness.Instance> | undefined,
  remembered: ReadonlyArray<Harness.Instance> | undefined,
  /** Whether a harness may still be shown its remembered models; an agent that stays empty for good loses them. */
  fill: (id: Harness.InstanceID) => boolean = () => true,
) {
  if (!fresh || !remembered) return fresh
  return fresh.map((item) => {
    if (item.driver === Harness.OpenCodeDriver || item.status !== "available" || item.models.length > 0) return item
    if (!fill(item.id)) return item
    const models = remembered.find((entry) => entry.id === item.id)?.models
    return models?.length ? { ...item, models } : item
  })
}

/** How long an agent that answers with no models is still shown the models it listed before. */
export const REMEMBERED_MODELS_MS = 60_000

/**
 * Tracks, per harness, since when it has answered with no models, and says whether the remembered models may still
 * stand in: for `REMEMBERED_MODELS_MS`, long enough for an agent that is starting to list them. After that the
 * harness really has none (signed out, or its CLI dropped them) and the picker says so.
 */
export function createRememberedModelWindow(now: () => number = Date.now) {
  const emptySince = new Map<string, number>()
  return {
    observe(list: ReadonlyArray<Harness.Instance> | undefined) {
      for (const item of list ?? []) {
        if (item.status === "available" && item.models.length === 0) {
          if (!emptySince.has(item.id)) emptySince.set(item.id, now())
          continue
        }
        emptySince.delete(item.id)
      }
    },
    fill: (id: Harness.InstanceID) => {
      const since = emptySince.get(id)
      return since === undefined || now() - since < REMEMBERED_MODELS_MS
    },
  }
}

/**
 * The model a harness starts with when it is picked: the one last used with it while that model is still listed
 * (or while the list is not in yet), else the harness default. The built-in loop picks its model elsewhere.
 */
export function harnessModelFor(instance: Harness.Instance, last: Harness.ModelSelection | undefined) {
  if (instance.driver === Harness.OpenCodeDriver) return undefined
  // Only a model the list still offers is restored. While the list isn't in yet the remembered one stands in; once
  // the harness lists models, `reconcileHarnessModel` moves off it if it is gone.
  if (last && (instance.models.length === 0 || instance.models.some((model) => model.id === last.id))) return last
  const model = instance.models.find((item) => item.isDefault) ?? instance.models[0]
  return model
    ? { id: model.id, reasoningEffort: model.defaultReasoningEffort, serviceTier: model.defaultServiceTier }
    : undefined
}
