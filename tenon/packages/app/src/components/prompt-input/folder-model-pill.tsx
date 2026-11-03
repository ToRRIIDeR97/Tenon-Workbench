import { createEffect } from "solid-js"
import { useDialog } from "@tenon/ui/context/dialog"
import { DialogSelectModelUnpaidV2 } from "@/components/dialog-select-model-unpaid-v2"
import type { PromptInputHarnessController } from "@/components/prompt-input/harness-controls"
import { PromptModelPill } from "@/components/prompt-input/model-pill"
import { useLanguage } from "@/context/language"
import { LocalProvider, useLocal } from "@/context/local"
import { ModelsProvider } from "@/context/models"
import type { PromptModel } from "@/context/prompt"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useProviders } from "@/hooks/use-providers"

/**
 * The model pill for a composer outside a folder's providers (Home, the Command Centre). For the built-in agent it
 * mounts the folder's own model selection here: the same one a new thread in that folder starts from. It reports
 * the model and reasoning so the page can start the thread with them.
 */
export function FolderModelPill(props: {
  directory: string
  harness: PromptInputHarnessController
  builtIn: boolean
  onModel: (model: PromptModel | undefined) => void
}) {
  return (
    <ModelsProvider directory={() => props.directory}>
      <SDKProvider directory={() => props.directory}>
        <LocalProvider>
          <BuiltInPill {...props} />
        </LocalProvider>
      </SDKProvider>
    </ModelsProvider>
  )
}

function BuiltInPill(props: Parameters<typeof FolderModelPill>[0]) {
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const providers = useProviders(() => sdk().directory)
  const paid = () =>
    providers.paid().length > 0 || providers.connected().some((provider) => Object.keys(provider.models).length > 0)

  createEffect(() => {
    const model = local.model.current()
    props.onModel(
      model
        ? { providerID: model.provider.id, modelID: model.id, variant: local.model.variant.current() ?? null }
        : undefined,
    )
  })

  const choose = () => {
    if (!paid()) return void dialog.show(() => <DialogSelectModelUnpaidV2 model={local.model} />)
    void import("@/components/dialog-select-model").then(({ DialogSelectModel }) =>
      dialog.show(() => <DialogSelectModel model={local.model} />),
    )
  }

  return (
    <PromptModelPill
      harness={props.harness}
      builtIn={props.builtIn}
      builtInModel={{
        name: local.model.current()?.name ?? language.t("dialog.model.select.title"),
        choose,
      }}
      builtInVariant={{
        options: () => ["default", ...local.model.variant.list()],
        current: () => local.model.variant.current() ?? "default",
        set: (value) => local.model.variant.set(value === "default" ? undefined : value),
        disabled: () => false,
      }}
    />
  )
}
