import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { commitChanges, openPullRequest, pushBranch, vcsInfo } from "@/utils/server"
import { pullRequestDraft, suggestBranch } from "./publish"

const labelClass = "flex flex-col gap-1.5 text-[13px] text-v2-text-text-base"

export function DialogCommit(props: { directory: string; threadTitle: string; files: number }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  const [state, setState] = createStore({
    message: props.threadTitle,
    branch: "",
    branchTouched: false,
    push: true,
    pullRequest: false,
    prTitle: "",
    prBody: "",
    prTouched: false,
    draft: true,
    busy: false,
    step: "" as "" | "commit" | "push" | "pr",
    error: "",
    done: undefined as undefined | { sha: string; branch: string; url?: string; pushed: boolean },
  })
  const [info] = createResource(async () => {
    const value = await vcsInfo(server(), props.directory).catch(() => ({ branch: null, defaultBranch: null }))
    if (!state.branchTouched && value.branch && value.branch === value.defaultBranch)
      setState("branch", suggestBranch(props.threadTitle))
    return value
  })
  const onDefault = () => !!info.latest?.branch && info.latest.branch === info.latest.defaultBranch
  const pr = () =>
    state.prTouched ? { title: state.prTitle, body: state.prBody } : pullRequestDraft(state.message, props.threadTitle)

  const message = (error: unknown) => (error instanceof Error ? error.message : language.t("secondBrain.error.request"))

  const submit = async () => {
    if (state.busy || !state.message.trim()) return
    setState({ busy: true, error: "", step: "commit" })
    const committed = await commitChanges(server(), props.directory, {
      message: state.message.trim(),
      ...(state.branch.trim() ? { branch: state.branch.trim() } : {}),
    }).catch((error: unknown) => {
      setState({ error: message(error), busy: false, step: "" })
      return undefined
    })
    if (!committed) return
    const result = { ...committed, pushed: false, url: undefined as string | undefined }
    let failure = ""
    if (state.push) {
      setState("step", "push")
      await pushBranch(server(), props.directory).then(
        () => (result.pushed = true),
        (error: unknown) => (failure = message(error)),
      )
    }
    if (result.pushed && state.pullRequest) {
      setState("step", "pr")
      const draft = pr()
      await openPullRequest(server(), props.directory, {
        title: draft.title.trim() || state.message.trim().split("\n")[0]!,
        body: draft.body,
        ...(info.latest?.defaultBranch ? { base: info.latest.defaultBranch } : {}),
        draft: state.draft,
      }).then(
        (opened) => (result.url = opened.url),
        (error: unknown) => (failure = message(error)),
      )
    }
    setState({ done: result, error: failure, step: "", busy: false })
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.git.commit.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(520px,calc(100vw-32px))] flex-col gap-4 px-4 pb-2">
        <Show
          when={state.done}
          fallback={
            <form
              class="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <p class="type-meta text-v2-text-text-muted">
                {language.t("secondBrain.git.commit.summary", {
                  count: props.files,
                  branch: info.latest?.branch ?? "…",
                })}
              </p>
              <label class={labelClass}>
                {language.t("secondBrain.git.commit.message")}
                <TextareaV2
                  ref={(element: HTMLElement) => element.setAttribute("autofocus", "")}
                  rows={4}
                  class="!w-full"
                  value={state.message}
                  onInput={(event) => setState("message", event.currentTarget.value)}
                />
              </label>
              <label class={labelClass}>
                {language.t("secondBrain.git.commit.branch")}
                <TextInputV2
                  class="!w-full"
                  placeholder={info.latest?.branch ?? ""}
                  value={state.branch}
                  onInput={(event) => setState({ branch: event.currentTarget.value, branchTouched: true })}
                />
                <span class="type-meta text-v2-text-text-muted">
                  {onDefault()
                    ? language.t("secondBrain.git.commit.branch.default")
                    : language.t("secondBrain.git.commit.branch.hint")}
                </span>
              </label>
              <CheckboxV2
                checked={state.push}
                label={language.t("secondBrain.git.commit.push")}
                onChange={(value: boolean) => setState("push", value)}
              />
              <CheckboxV2
                checked={state.push && state.pullRequest}
                disabled={!state.push}
                label={language.t("secondBrain.git.commit.pr")}
                onChange={(value: boolean) => setState("pullRequest", value)}
              />
              <Show when={state.push && state.pullRequest}>
                <div class="flex flex-col gap-3 rounded-[12px] bg-v2-background-bg-layer-01 p-3">
                  <label class={labelClass}>
                    {language.t("secondBrain.git.commit.pr.title")}
                    <TextInputV2
                      class="!w-full"
                      value={pr().title}
                      onInput={(event) =>
                        setState({ prTitle: event.currentTarget.value, prBody: pr().body, prTouched: true })
                      }
                    />
                  </label>
                  <label class={labelClass}>
                    {language.t("secondBrain.git.commit.pr.body")}
                    <TextareaV2
                      rows={4}
                      class="!w-full"
                      value={pr().body}
                      onInput={(event) =>
                        setState({ prBody: event.currentTarget.value, prTitle: pr().title, prTouched: true })
                      }
                    />
                  </label>
                  <CheckboxV2
                    checked={state.draft}
                    label={language.t("secondBrain.git.commit.pr.draft")}
                    onChange={(value: boolean) => setState("draft", value)}
                  />
                </div>
              </Show>
              <Show when={state.error}>
                <p role="alert" class="type-meta text-v2-text-text-critical">
                  {state.error}
                </p>
              </Show>
            </form>
          }
        >
          {(done) => (
            <div class="flex flex-col gap-2 text-[13px] text-v2-text-text-base" role="status">
              <p>
                {language.t(done().pushed ? "secondBrain.git.commit.done.pushed" : "secondBrain.git.commit.done", {
                  sha: done().sha.slice(0, 7),
                  branch: done().branch,
                })}
              </p>
              <Show when={state.error}>
                <p role="alert" class="type-meta text-v2-text-text-critical">
                  {language.t("secondBrain.git.commit.partial", { error: state.error })}
                </p>
              </Show>
              <Show when={done().url}>
                {(url) => (
                  <ButtonV2 variant="outline" class="self-start" onClick={() => platform.openExternal(url())}>
                    {language.t("secondBrain.git.commit.done.openPr")}
                  </ButtonV2>
                )}
              </Show>
            </div>
          )}
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t(state.done ? "common.close" : "common.cancel")}
        </ButtonV2>
        <Show when={!state.done}>
          <ButtonV2 variant="contrast" disabled={state.busy || !state.message.trim()} onClick={() => void submit()}>
            {state.busy
              ? language.t(`secondBrain.git.commit.step.${state.step || "commit"}`)
              : language.t(
                  state.push && state.pullRequest
                    ? "secondBrain.git.commit.confirm.pr"
                    : state.push
                      ? "secondBrain.git.commit.confirm.push"
                      : "secondBrain.git.commit.confirm",
                )}
          </ButtonV2>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
