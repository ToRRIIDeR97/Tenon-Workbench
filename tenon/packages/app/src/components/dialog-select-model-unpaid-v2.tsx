import { DialogBody, DialogHeader, DialogTitle, DialogV2 } from "@tenon/ui/v2/dialog-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { ProviderIcon } from "@tenon/ui/provider-icon"
import { Tag } from "@tenon/ui/v2/badge-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { useTheme } from "@tenon/ui/theme"
import { createMemo, onCleanup, onMount, type Component, For, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { useProviders } from "@/hooks/use-providers"
import { decode64 } from "@/utils/base64"
import { useLanguage } from "@/context/language"
import { ModelTooltip } from "./model-tooltip"

type ModelState = ReturnType<typeof useLocal>["model"]
const featuredProviders = ["openai", "anthropic", "google", "github-copilot"]
const displayModelName = (name: string) => name.replace(/\s+(?:\(free\)|free)$/i, "")

export const DialogSelectModelUnpaidV2: Component<{ model?: ModelState }> = (props) => {
  const local = useLocal()
  const model = props.model ?? local.model
  const dialog = useDialog()
  const theme = useTheme()
  const directory = () => decode64(local.slug())
  const providers = useProviders(directory)
  const language = useLanguage()
  const modelKey = (item: ReturnType<ModelState["list"]>[number]) => `${item.provider.id}:${item.id}`
  const currentKey = createMemo(() => {
    const c = model.current()
    return c ? `${c.provider.id}:${c.id}` : undefined
  })
  const isFree = (item: ReturnType<ModelState["list"]>[number]) =>
    item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)
  const freeModels = createMemo(() => model.list().filter(isFree))

  const openProviders = (provider?: string) => {
    void import("./dialog-connect-provider").then((x) => {
      const controller = x.useProviderConnectController()
      controller.select(provider)
      void dialog.show(() => <x.DialogConnectProvider controller={controller} directory={directory} />)
    })
  }

  const selectModel = (item: ReturnType<ModelState["list"]>[number]) => {
    model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
    dialog.close()
  }

  // Focus starts on the dialog's close button, outside the list, so listen at the
  // document level while the dialog is mounted instead of on the list container.
  let listEl: HTMLDivElement | undefined
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
      if (!listEl) return
      const buttons = Array.from(listEl.querySelectorAll<HTMLButtonElement>("button"))
      if (buttons.length === 0) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        index < 0 ? (e.key === "ArrowDown" ? 0 : buttons.length - 1) : index + (e.key === "ArrowDown" ? 1 : -1)
      buttons[(next + buttons.length) % buttons.length]?.focus()
      e.preventDefault()
    }
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
  })

  return (
    <DialogV2
      fit
      containerClass="!h-auto max-h-[calc(100vh_-_16px)] !w-[min(calc(100vw_-_16px),640px)]"
      class="[&_[data-slot=dialog-header]]:!px-6"
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("dialog.model.select.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="max-h-[calc(100vh_-_68px)] min-h-0 flex-none gap-0 overflow-y-auto px-2 pb-2">
        <div ref={listEl} class="flex min-h-0 flex-col">
          <div data-section="free-models" class="flex w-full flex-col items-start pb-3">
            <div class="flex h-8 w-full flex-none select-none flex-row items-center px-3 pb-2">
              <div class="flex h-5 items-center type-meta font-medium text-v2-text-text-muted">
                {language.t("dialog.model.unpaid.freeModels.title")}
              </div>
            </div>
            <For each={freeModels()}>
              {(item) => (
                <TooltipV2
                  class="w-full"
                  placement="right-start"
                  gutter={6}
                  value={
                    <ModelTooltip
                      model={{ ...item, name: displayModelName(item.name) }}
                      latest={item.latest}
                      free={isFree(item)}
                    />
                  }
                >
                  <button
                    type="button"
                    class="flex min-h-10 w-full scroll-my-4 flex-row items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] font-medium leading-5 text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                    classList={{
                      "!bg-v2-background-bg-accent-container !text-v2-text-text-on-accent-container":
                        currentKey() === modelKey(item),
                    }}
                    aria-pressed={currentKey() === modelKey(item)}
                    onClick={() => selectModel(item)}
                  >
                    <span class="min-w-0 truncate">{displayModelName(item.name)}</span>
                    <Tag class="shrink-0">{language.t("model.tag.free")}</Tag>
                    <Show when={item.latest}>
                      <Tag class="shrink-0">{language.t("model.tag.latest")}</Tag>
                    </Show>
                    <Show when={currentKey() === modelKey(item)}>
                      <Icon name="check" class="ml-auto size-4 shrink-0" />
                    </Show>
                  </button>
                </TooltipV2>
              )}
            </For>
          </div>

          <div class="flex w-full flex-col">
            <div class="flex w-full flex-col items-start rounded-[16px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3 pt-2">
              <div class="flex h-8 w-full select-none items-center px-1 pb-2">
                <div class="flex h-5 items-center type-meta font-medium text-v2-text-text-muted">
                  {language.t("dialog.model.unpaid.addMore.title")}
                </div>
              </div>
              <div class="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <For
                  each={[...providers.popular()]
                    .filter((provider) => featuredProviders.includes(provider.id))
                    .sort((a, b) => featuredProviders.indexOf(a.id) - featuredProviders.indexOf(b.id))}
                >
                  {(provider) => (
                    <button
                      type="button"
                      data-provider-id={provider.id}
                      class="flex min-h-10 w-full scroll-my-4 flex-row items-start gap-2 rounded-[12px] bg-v2-background-bg-base px-3 py-2 text-left text-[13px] font-medium leading-5 text-v2-text-text-base transition-colors duration-short ease-standard hover:[background-image:linear-gradient(var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                      classList={{
                        "border border-v2-border-border-muted": theme.mode() !== "dark",
                        "border border-v2-border-border-strong": theme.mode() === "dark",
                      }}
                      onClick={() => openProviders(provider.id)}
                    >
                      <ProviderIcon id={provider.id} class="mt-0.5 size-4 shrink-0 text-v2-icon-icon-base" />
                      <span class="flex min-w-0 flex-col">
                        <span class="truncate">{provider.name}</span>
                      </span>
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  class="col-span-full flex h-8 w-full scroll-my-4 items-center justify-start rounded-full px-3 text-left type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                  onClick={() => openProviders()}
                >
                  {language.t("dialog.model.unpaid.viewMoreProviders")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </DialogBody>
    </DialogV2>
  )
}
