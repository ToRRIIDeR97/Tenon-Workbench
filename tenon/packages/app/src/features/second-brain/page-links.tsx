import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { listRowClass } from "@/components/surface-classes"
import {
  moveVaultPage,
  readVaultBacklinks,
  SecondBrainRequestError,
  type ProjectRecord,
  type VaultPage,
} from "./client"

type VaultClient = Parameters<typeof readVaultBacklinks>[0]

export function PageBacklinks(props: {
  client: VaultClient
  path: string
  revision: string
  onOpen: (path: string) => void
}) {
  const language = useLanguage()
  const [links, actions] = createResource(
    () => (props.revision ? ([props.path, props.revision] as const) : undefined),
    ([path]) => readVaultBacklinks(props.client, path),
  )
  return (
    <section aria-labelledby="page-backlinks-title" class="flex flex-col gap-2 pb-10" data-component="page-backlinks">
      <h2 id="page-backlinks-title" class="type-label text-v2-text-text-muted">
        {language.t("secondBrain.vault.backlinks.title")}
      </h2>
      <Show
        when={!links.error}
        fallback={
          <div class="flex items-center gap-2">
            <p class="type-meta text-v2-text-text-critical">{language.t("secondBrain.error.request")}</p>
            <ButtonV2 size="small" variant="outline" onClick={() => void actions.refetch()}>
              {language.t("secondBrain.error.retry")}
            </ButtonV2>
          </div>
        }
      >
        <Show
          when={(links.latest ?? []).length > 0}
          fallback={
            <Show when={!links.loading}>
              <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.vault.backlinks.empty")}</p>
            </Show>
          }
        >
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <For each={links.latest ?? []}>
              {(link) => (
                <li>
                  <button
                    type="button"
                    class={`${listRowClass} flex-col !items-start !gap-0.5`}
                    onClick={() => props.onOpen(link.path)}
                  >
                    <span class="truncate text-[13px] [font-weight:500]">{link.title}</span>
                    <span class="line-clamp-2 type-meta text-v2-text-text-muted">{link.snippet}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  )
}

export function DialogMovePage(props: {
  client: VaultClient
  mode: "rename" | "move"
  path: string
  title: string
  revision: string
  projectId: string | null
  projects: ReadonlyArray<ProjectRecord>
  onMoved: (result: { page: VaultPage; updatedLinks: number }) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({
    title: props.title,
    projectId: props.projectId ?? "",
    saving: false,
    error: "",
  })
  const changed = () =>
    props.mode === "rename"
      ? !!state.title.trim() && state.title.trim() !== props.title
      : (state.projectId || null) !== props.projectId
  const submit = async () => {
    if (!changed() || state.saving) return
    setState({ saving: true, error: "" })
    const result = await moveVaultPage(props.client, {
      path: props.path,
      expectedRevision: props.revision,
      ...(props.mode === "rename" ? { title: state.title.trim() } : { projectId: state.projectId || null }),
    }).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    )
    setState("saving", false)
    if (result.value) {
      dialog.close()
      props.onMoved(result.value)
      return
    }
    const status = result.error instanceof SecondBrainRequestError ? result.error.status : 0
    const reason = result.error instanceof SecondBrainRequestError ? result.error.reason : undefined
    setState(
      "error",
      language.t(
        status === 409
          ? reason === "exists"
            ? "secondBrain.vault.exists"
            : "secondBrain.vault.conflict"
          : status === 400
            ? "secondBrain.vault.move.invalid"
            : "secondBrain.error.request",
      ),
    )
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>
          {language.t(props.mode === "rename" ? "secondBrain.vault.rename.title" : "secondBrain.vault.move.title")}
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(440px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2">
        <form
          class="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Show
            when={props.mode === "rename"}
            fallback={
              <label class="flex flex-col gap-1.5 text-[13px] text-v2-text-text-base">
                {language.t("secondBrain.vault.move.project")}
                <select
                  class="h-9 rounded-[12px] bg-v2-background-bg-layer-01 px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--v2-border-border-base)]"
                  value={state.projectId}
                  onChange={(event) => setState("projectId", event.currentTarget.value)}
                >
                  <option value="">{language.t("secondBrain.vault.move.noProject")}</option>
                  <For each={props.projects.filter((project) => project.status !== "archived")}>
                    {(project) => <option value={project.id}>{project.name}</option>}
                  </For>
                </select>
              </label>
            }
          >
            <label class="flex flex-col gap-1.5 text-[13px] text-v2-text-text-base">
              {language.t("secondBrain.vault.rename.label")}
              <input
                ref={(element: HTMLElement) => element.setAttribute("autofocus", "")}
                class="h-9 rounded-[12px] bg-v2-background-bg-layer-01 px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
                value={state.title}
                onInput={(event) => setState("title", event.currentTarget.value)}
              />
            </label>
          </Show>
          <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.vault.move.links")}</p>
          <Show when={state.error}>
            <p role="alert" class="type-meta text-v2-text-text-critical">
              {state.error}
            </p>
          </Show>
        </form>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!changed() || state.saving} onClick={() => void submit()}>
          {language.t(props.mode === "rename" ? "secondBrain.vault.rename.confirm" : "secondBrain.vault.move.confirm")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
