import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { listVaultPageVersions, readVaultPageVersion } from "./client"

type VaultClient = Parameters<typeof listVaultPageVersions>[0]

/**
 * A page's saved versions: pick one to preview it, then restore it. Restoring is a normal save over the current
 * revision, so it can report a conflict like any other, and the replaced text becomes a version in turn.
 */
export function DialogPageVersions(props: {
  client: VaultClient
  path: string
  /** Edits on screen would be lost, so the page must be saved or discarded first. */
  blocked: boolean
  onRestore: (body: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({ selected: "" })
  const [versions] = createResource(() => listVaultPageVersions(props.client, props.path))
  const [version] = createResource(
    () => state.selected || undefined,
    (revision) => readVaultPageVersion(props.client, props.path, revision),
  )
  const list = () => (versions.error ? [] : (versions.latest ?? []))
  const preview = () => (version.error || version.loading ? undefined : version.latest?.body)
  const label = (updatedAt: string) =>
    new Date(updatedAt).toLocaleString(language.intl(), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.vault.versions")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(720px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2">
        <Show
          when={list().length > 0}
          fallback={
            <p class="text-[13px] text-v2-text-text-muted">
              {versions.loading
                ? language.t("common.loading")
                : language.t(versions.error ? "secondBrain.error.request" : "secondBrain.vault.versions.empty")}
            </p>
          }
        >
          <div class="grid h-[min(420px,60vh)] min-h-0 grid-cols-[180px_minmax(0,1fr)] gap-3">
            <ul
              class="flex min-h-0 flex-col gap-px overflow-y-auto"
              aria-label={language.t("secondBrain.vault.versions")}
            >
              <For each={list()}>
                {(item) => (
                  <li>
                    <button
                      type="button"
                      aria-pressed={state.selected === item.revision}
                      classList={{
                        "w-full rounded-[12px] px-2.5 py-1.5 text-left text-[13px] tabular-nums transition-colors duration-short ease-standard motion-reduce:transition-none": true,
                        "bg-v2-background-bg-layer-02 text-v2-text-text-base": state.selected === item.revision,
                        "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover":
                          state.selected !== item.revision,
                      }}
                      onClick={() => setState("selected", item.revision)}
                    >
                      {label(item.updatedAt)}
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <pre class="min-h-0 overflow-y-auto whitespace-pre-wrap break-words rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2 font-sans text-[13px] leading-5 text-v2-text-text-base">
              {preview() ?? ""}
            </pre>
          </div>
          <Show when={version.error}>
            <p role="alert" class="text-[12px] text-v2-text-text-critical">
              {language.t("secondBrain.error.request")}
            </p>
          </Show>
          <Show when={props.blocked}>
            <p class="text-[12px] text-v2-text-text-muted">{language.t("secondBrain.vault.versions.dirty")}</p>
          </Show>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="contrast"
          disabled={props.blocked || preview() === undefined}
          onClick={() => {
            const body = preview()
            if (body === undefined) return
            dialog.close()
            props.onRestore(body)
          }}
        >
          {language.t("secondBrain.vault.versions.restore")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
