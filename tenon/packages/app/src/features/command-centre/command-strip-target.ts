import { Harness } from "@tenon/schema/harness"
import type { CommandChoice } from "./command-centre"

type ModelChoice = { providerID: string; modelID: string; variant?: string | null }

/**
 * The thread the Command Centre card replies to (#329): the one picked in its thread menu while it still exists,
 * else the newest; `null` (New thread) targets none, so the next send starts one.
 */
export function stripTarget(
  chosen: string | null | undefined,
  threads: ReadonlyArray<{ id: string }>,
  newest: string | undefined,
): string | null {
  if (chosen === null) return null
  if (chosen && threads.some((thread) => thread.id === chosen)) return chosen
  return newest ?? null
}

/**
 * What a Command Centre send runs on. A new thread takes the model pill's harness and model (Settings when nothing
 * was picked). A reply keeps its thread's own harness: a built-in prompt can't go to a harness thread, nor the
 * reverse, whatever the pill shows; a built-in reply takes the pill's model only when the pill is on the built-in
 * agent.
 */
export function promptRoute(input: {
  choice?: CommandChoice
  defaults: { harnessID: Harness.InstanceID; model?: ModelChoice }
  thread?: { harnessID: Harness.InstanceID }
}): { harnessID: Harness.InstanceID; harness: boolean; model?: ModelChoice } {
  const harnessID = input.thread?.harnessID ?? input.choice?.harnessID ?? input.defaults.harnessID
  if (harnessID !== Harness.OpenCode) return { harnessID, harness: true }
  const pillBuiltIn = input.choice?.harnessID === Harness.OpenCode
  const model = input.choice && (pillBuiltIn || !input.thread) ? input.choice.model : input.defaults.model
  return model ? { harnessID, harness: false, model } : { harnessID, harness: false }
}

/**
 * What a reply runs on, for the card: the thread's harness and model as the harness list names them. A built-in
 * thread replies on Settings › Command Centre's model, since the card sends replies without the pill's pick.
 */
export function runsOnLabel(input: {
  harnessID: string
  harnessModel?: { id: string }
  defaultModel?: string
  instances: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string }> }> | undefined
}) {
  const instance = input.instances?.find((item) => item.id === input.harnessID)
  const harness = instance?.name ?? input.harnessID
  const model =
    input.harnessID === Harness.OpenCode
      ? input.defaultModel?.slice(input.defaultModel.indexOf("/") + 1)
      : input.harnessModel &&
        (instance?.models.find((item) => item.id === input.harnessModel!.id)?.name ?? input.harnessModel.id)
  return model ? `${harness} · ${model}` : harness
}
