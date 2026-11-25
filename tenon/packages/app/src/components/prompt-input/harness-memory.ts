import { Harness } from "@tenon/schema/harness"

const FAST_RETRIES = 10
const FAST_RETRY_MS = 3_000
const SLOW_RETRY_MS = 15_000

export function harnessRetryDelay(failures: number) {
  return failures < FAST_RETRIES ? FAST_RETRY_MS : SLOW_RETRY_MS
}

export function withRememberedModels(
  fresh: ReadonlyArray<Harness.Instance> | undefined,
  remembered: ReadonlyArray<Harness.Instance> | undefined,
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

export const REMEMBERED_MODELS_MS = 60_000

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

export function harnessModelFor(instance: Harness.Instance, last: Harness.ModelSelection | undefined) {
  if (instance.driver === Harness.OpenCodeDriver) return undefined
  if (last && (instance.models.length === 0 || instance.models.some((model) => model.id === last.id))) return last
  const model = instance.models.find((item) => item.isDefault) ?? instance.models[0]
  return model
    ? { id: model.id, reasoningEffort: model.defaultReasoningEffort, serviceTier: model.defaultServiceTier }
    : undefined
}
