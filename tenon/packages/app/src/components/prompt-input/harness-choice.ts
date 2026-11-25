import type { Harness } from "@tenon/schema/harness"
import { matchesModelSearch, normalizeModelSearch } from "@/components/dialog-select-model-search"
import type { PromptInputHarnessController } from "./harness-controls"

export const searchableModelCount = 8

export function filterHarnessModels<T extends { id: string; name?: string }>(models: ReadonlyArray<T>, query: string) {
  const words = normalizeModelSearch(query).split(" ").filter(Boolean)
  return models.filter((model) => words.every((word) => matchesModelSearch(word, [model.name ?? "", model.id])))
}

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
