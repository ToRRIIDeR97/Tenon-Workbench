import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { readInstructions, removeInstructions, writeInstructions } from "@/features/second-brain/client"
import type { SidebarProjectItem } from "@/components/sidebar/sidebar-controller"
import { errorMessage } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"
import { instructionsErrorKey } from "./instructions-error"

/**
 * Edit a workspace's default AGENTS.md, or a project's own one. A project without its own file uses
 * the workspace default; "Use workspace default" deletes the project's file after a confirmation.
 */
export function DialogInstructions(props: { workspaceDirectory: string; project?: SidebarProjectItem }) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })
  const directory = () => props.project?.threadDirectory ?? props.workspaceDirectory
  const [state, setState] = createStore({ draft: "", editing: false, busy: false, confirmRemove: false })
  const [own, ownActions] = createResource(async () => {
    const result = await readInstructions(client(directory()))
    setState({ draft: result.content ?? "", editing: result.content !== null })
    return result
  })
  const [fallback, fallbackActions] = createResource(
    () => (props.project ? props.workspaceDirectory : undefined),
    (workspace) => readInstructions(client(workspace)),
  )

  const failed = (cause: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description:
        instructionsErrorKey(cause) === "secondBrain.error.request"
          ? errorMessage(cause, language.t("common.requestFailed"))
          : language.t(instructionsErrorKey(cause)),
    })

  const save = () => {
    setState("busy", true)
    void writeInstructions(client(directory()), state.draft)
      .then((result) => {
        ownActions.mutate(result)
        showToast({ title: language.t("secondBrain.instructions.saved"), description: result.path })
      })
      .catch(failed)
      .finally(() => setState("busy", false))
  }

  const useDefault = () => {
    if (!state.confirmRemove) return setState("confirmRemove", true)
    setState({ busy: true, confirmRemove: false })
    void removeInstructions(client(directory()))
      .then((result) => {
        ownActions.mutate(result)
        setState({ draft: "", editing: false })
      })
      .catch(failed)
      .finally(() => setState("busy", false))
  }

  // Reading a failed resource throws, so read through these and show the failure with a retry.
  const ownFile = () => (own.error ? undefined : own())
  const fallbackFile = () => (fallback.error ? undefined : fallback())
  const loadFailed = () => !!own.error || !!fallback.error
  const loadError = () => language.t(instructionsErrorKey(own.error ?? fallback.error))
  const retry = () => {
    if (own.error) void ownActions.refetch()
    if (fallback.error) void fallbackActions.refetch()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>
          {props.project
            ? `${language.t("secondBrain.sidebar.projectInstructions")}: ${props.project.name}`
            : language.t("secondBrain.sidebar.workspaceInstructions")}
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(640px,calc(100vw-32px))] flex-col gap-4 px-5 pb-3">
        <div class="flex flex-col gap-1">
          <p class="text-[13px] leading-5 text-v2-text-text-muted">
            {props.project
              ? language.t(
                  state.editing ? "secondBrain.instructions.projectOwn" : "secondBrain.instructions.projectDefault",
                )
              : language.t("secondBrain.instructions.workspaceHint")}
          </p>
          <Show when={ownFile()}>
            {(file) => (
              <code class="truncate font-mono text-[12px] text-v2-text-text-muted" title={file().path}>
                {file().path}
              </code>
            )}
          </Show>
        </div>
        <Show when={loadFailed()}>
          <div
            role="alert"
            class="flex items-start gap-3 rounded-[12px] bg-v2-state-bg-danger px-3 py-2.5 text-[13px] leading-5 text-v2-state-fg-danger"
          >
            <p class="min-w-0 flex-1">{loadError()}</p>
            <ButtonV2 size="small" variant="outline" onClick={retry}>
              {language.t("secondBrain.error.retry")}
            </ButtonV2>
          </div>
        </Show>
        <Show when={state.confirmRemove}>
          <p class="text-[13px] text-v2-text-text-base">{language.t("secondBrain.instructions.confirmUseDefault")}</p>
        </Show>
        <Show
          when={state.editing || !props.project}
          fallback={
            // Unread, the project's own file could still exist: customizing would overwrite it.
            <Show when={!fallback.error && !own.error}>
              <section class="flex flex-col overflow-hidden rounded-[16px] bg-v2-background-bg-layer-01">
                <header class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="text-[12px] text-v2-text-text-muted [font-weight:500]">
                    {language.t("secondBrain.instructions.workspaceDefault")}
                  </span>
                  <ButtonV2
                    size="small"
                    variant="neutral"
                    disabled={fallback.loading}
                    onClick={() => setState({ editing: true, draft: fallbackFile()?.content ?? "" })}
                  >
                    {language.t("secondBrain.instructions.customize")}
                  </ButtonV2>
                </header>
                <pre class="max-h-72 overflow-auto whitespace-pre-wrap border-t border-v2-border-border-muted px-3 py-2.5 font-mono text-[12px] leading-5 text-v2-text-text-base">
                  {fallbackFile()?.content || language.t("secondBrain.instructions.emptyDefault")}
                </pre>
              </section>
            </Show>
          }
        >
          <TextareaV2
            rows={14}
            value={state.draft}
            placeholder={language.t("secondBrain.instructions.placeholder")}
            disabled={own.loading || !!own.error}
            onInput={(event) => setState("draft", event.currentTarget.value)}
          />
        </Show>
      </DialogBody>
      <DialogFooter>
        <Show when={props.project && ownFile()?.content !== null && ownFile()?.content !== undefined}>
          <Show when={state.confirmRemove}>
            <ButtonV2
              size="small"
              variant="ghost"
              disabled={state.busy}
              onClick={() => setState("confirmRemove", false)}
            >
              {language.t("common.cancel")}
            </ButtonV2>
          </Show>
          <ButtonV2
            size="small"
            variant={state.confirmRemove ? "danger" : "ghost"}
            disabled={state.busy}
            onClick={useDefault}
          >
            {language.t(state.confirmRemove ? "common.delete" : "secondBrain.instructions.useDefault")}
          </ButtonV2>
        </Show>
        <Show when={state.editing || !props.project}>
          <ButtonV2 size="small" variant="contrast" disabled={state.busy || own.loading || !!own.error} onClick={save}>
            {language.t("common.save")}
          </ButtonV2>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
