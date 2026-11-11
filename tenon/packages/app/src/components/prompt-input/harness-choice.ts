import type { Harness } from "@tenon/schema/harness"
import { matchesModelSearch, normalizeModelSearch } from "@/components/dialog-select-model-search"
import type { PromptInputHarnessController } from "./harness-controls"

/** Lists with more models than this get a search box in the model pill. */
export const searchableModelCount = 8

/**
 * The models whose name or id holds every word of the query, across separators: "claude opus" finds claude-opus-5-5
 * and "deepseek flash" finds "DeepSeek V4.1 Flash Free".
 */
export function filterHarnessModels<T extends { id: string; name?: string }>(models: ReadonlyArray<T>, query: string) {
  const words = normalizeModelSearch(query).split(" ").filter(Boolean)
  return models.filter((model) => words.every((word) => matchesModelSearch(word, [model.name ?? "", model.id])))
}

/**
 * The controller with every harness or model the user picks reported to `remember`, so the next new thread starts
 * on the latest choice from any composer, not only the one a new thread was sent with. Automatic changes (a harness
 * falling back, a model list reloading) go through the inner controller and are not reported.
 */
export function rememberingHarness(
  controller: PromptInputHarnessController,
  remember: (choice: { harnessID: string; model?: Harness.ModelSelection }) => void,
): PromptInputHarnessController {
  return {
    ...controller,
    select: (instanceID) => {
      controller.select(instanceID)
      remember({ harnessID: instanceID, model: controller.model.current() })
    },
    model: {
      current: controller.model.current,
      set: (model) => {
        controller.model.set(model)
        remember({ harnessID: controller.current(), model })
      },
    },
  }
}
