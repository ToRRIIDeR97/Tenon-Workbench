import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { For, Match, Show, Switch, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { sessionHref } from "@/utils/session-route"
import { projectGithubWork } from "@/utils/server"
import { githubTaskRows, type GithubTaskRow, type GithubWork } from "./github-tasks"

/**
 * The linked repository's issues inside the Project's Tasks (#331, variant A): each open issue is a task with the
 * PR that closes it, read with the user's `gh` login. The repository is the folder's `origin` unless the Project
 * names another. Rows open on GitHub; ticking them done happens there (merging the PR closes the issue).
 */
// The Repository row and the task list read the same choice: a save in one makes the other read again.
const [repoSaves, setRepoSaves] = createStore<Record<string, number>>({})

export function ProjectGithubTasks(props: {
  projectId: string
  folder: string | undefined
  show: "open" | "all"
  /** Issue numbers a Tenon task already mirrors (`… (#N)`), left out here. */
  linked?: ReadonlySet<number>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const server = useServer()
  const navigate = useNavigate()
  const [request, setRequest] = createStore({
    options: {} as { refresh?: boolean },
    version: 0,
  })
  const [work] = createResource(
    () =>
      props.folder
        ? {
            folder: props.folder,
            options: request.options,
            version: request.version,
            saved: repoSaves[props.folder] ?? 0,
          }
        : undefined,
    (input): Promise<GithubWork> =>
      projectGithubWork({ server: serverSDK().server.http, fetch: platform.fetch }, input.folder, input.options).catch(
        (error: unknown) => ({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      ),
  )
  const rows = createMemo(() => {
    const value = work.latest
    return value?.status === "ok" ? githubTaskRows(value, props.show, Date.now(), props.linked) : []
  })
  const refetch = () => setRequest({ options: { refresh: true }, version: request.version + 1 })
  const openCount = () => {
    const value = work.latest
    return value?.status === "ok" ? value.issues.filter((issue) => issue.state === "open").length : 0
  }

  return (
    <Show when={props.folder ? work.latest : undefined}>
      {(value) => (
        <div data-component="project-github-tasks" class="flex flex-col divide-y divide-v2-border-border-muted">
          <div class="flex min-h-10 flex-wrap items-center gap-2 px-4 py-1.5">
            <span class="type-caption text-v2-text-text-muted">
              {value().status === "ok"
                ? language.t("secondBrain.github.header", {
                    repo: (value() as { repo: string }).repo,
                    count: openCount(),
                  })
                : language.t("secondBrain.github.title")}
            </span>
            <span class="flex-1" />
            <ButtonV2 size="small" variant="ghost" icon="reset" disabled={work.loading} onClick={() => void refetch()}>
              {language.t("secondBrain.github.refresh")}
            </ButtonV2>
          </div>
          <Switch>
            <Match when={value().status === "no-repo"}>
              <p class="px-4 py-2 type-meta text-v2-text-text-muted">{language.t("secondBrain.github.noRepo")}</p>
            </Match>
            <Match when={value().status === "no-gh"}>
              <p class="px-4 py-2 type-meta text-v2-text-text-muted">{language.t("secondBrain.github.noGh")}</p>
            </Match>
            <Match when={value().status === "signed-out"}>
              <p class="px-4 py-2 type-meta text-v2-text-text-muted">{language.t("secondBrain.github.signedOut")}</p>
            </Match>
            <Match when={value().status === "error"}>
              <p class="px-4 py-2 type-meta text-v2-text-text-muted">
                {language.t("secondBrain.github.failed", { message: (value() as { message: string }).message })}
              </p>
            </Match>
            <Match when={value().status === "ok" && rows().length === 0}>
              <p class="px-4 py-2 type-meta text-v2-text-text-muted">{language.t("secondBrain.github.none")}</p>
            </Match>
          </Switch>
          <ul class="flex flex-col divide-y divide-v2-border-border-muted">
            <For each={rows()}>
              {(row) => (
                <GithubTaskItem
                  row={row}
                  open={(url) => platform.openExternal(url)}
                  openThread={(id) => navigate(sessionHref(server.key, id))}
                />
              )}
            </For>
          </ul>
        </div>
      )}
    </Show>
  )
}

function GithubTaskItem(props: { row: GithubTaskRow; open: (url: string) => void; openThread: (id: string) => void }) {
  const language = useLanguage()
  const pull = () => props.row.pulls.find((item) => item.state === "open") ?? props.row.pulls[0]
  const detail = () =>
    [
      `#${props.row.number}`,
      pull()
        ? props.row.done && pull()!.state === "merged"
          ? language.t("secondBrain.github.doneWhenMerged", { number: pull()!.number })
          : language.t("secondBrain.github.pull", { number: pull()!.number })
        : "",
      props.row.author ? language.t("secondBrain.github.by", { author: props.row.author }) : "",
    ]
      .filter(Boolean)
      .join(" · ")
  return (
    <li class="flex items-center">
      <button
        type="button"
        data-github-issue={props.row.number}
        class="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-1.5 text-left outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
        onClick={() => props.open(props.row.url)}
      >
        {/* Read-only like a task's box: GitHub ticks it when the issue closes (a merged PR closes it). */}
        <span
          aria-hidden="true"
          class="flex size-4 shrink-0 items-center justify-center rounded-[5px] shadow-[inset_0_0_0_1.5px_var(--v2-border-border-base)]"
          classList={{ "bg-v2-background-bg-accent text-v2-text-text-on-accent !shadow-none": props.row.done }}
        >
          <Show when={props.row.done}>
            <Icon name="check" size="small" />
          </Show>
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span
            class="truncate text-[13px] text-v2-text-text-base"
            classList={{ "line-through text-v2-text-text-muted": props.row.done }}
          >
            {props.row.title}
          </span>
          <span class="truncate type-meta text-v2-text-text-muted">{detail()}</span>
        </span>
        <Show
          when={props.row.status}
          fallback={
            <Show when={!props.row.done}>
              <span class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-2 text-[11px] leading-5 text-v2-text-text-muted">
                {language.t("secondBrain.github.issue")}
              </span>
            </Show>
          }
        >
          {(status) => (
            <span
              class="shrink-0 rounded-full px-2 text-[11px] leading-5"
              classList={{
                "bg-v2-state-bg-warning text-v2-state-fg-warning":
                  status() === "checks-failing" || status() === "changes-requested",
                "bg-v2-background-bg-layer-02 text-v2-text-text-muted":
                  status() !== "checks-failing" && status() !== "changes-requested",
              }}
            >
              {language.t(`secondBrain.github.status.${status()}`)}
            </span>
          )}
        </Show>
      </button>
      {/* The thread that produced the PR, so a merged PR leads back to its conversation (#331). */}
      <Show when={props.row.thread}>
        {(thread) => (
          <ButtonV2
            size="small"
            variant="ghost-muted"
            data-action="github-task-thread"
            class="mr-2 max-w-48 shrink-0"
            title={thread().title}
            onClick={() => props.openThread(thread().id)}
          >
            <span class="truncate">{language.t("secondBrain.github.fromThread", { title: thread().title })}</span>
          </ButtonV2>
        )}
      </Show>
    </li>
  )
}

/**
 * The Project's Repository row (#331): the repository its tasks come from, filled from the folder's origin. A
 * different one is kept for the Project folder on the server; saving it empty goes back to the origin.
 */
export function ProjectRepository(props: { folder: string | undefined }) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  const [edit, setEdit] = createStore({ open: false, value: "", busy: false })
  const [work, { mutate }] = createResource(
    () => props.folder,
    (folder): Promise<GithubWork> =>
      projectGithubWork(server(), folder, {}).catch((error: unknown) => ({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      })),
  )
  const current = () => {
    const value = work.latest
    return value?.status === "ok" ? value : undefined
  }
  const save = () => {
    const folder = props.folder
    if (!folder || edit.busy) return
    setEdit("busy", true)
    void projectGithubWork(server(), folder, { repo: edit.value.trim(), save: true })
      .then((next) => {
        mutate(next)
        setRepoSaves(folder, (count = 0) => count + 1)
        setEdit({ open: false, busy: false })
      })
      .catch((error: unknown) => {
        setEdit("busy", false)
        mutate({ status: "error", message: error instanceof Error ? error.message : String(error) })
      })
  }
  return (
    <Show when={props.folder ? work.latest : undefined}>
      <section
        data-component="project-repository"
        class="flex flex-col gap-2 rounded-[16px] bg-v2-background-bg-layer-01 p-4 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
      >
        <div class="flex items-center gap-3">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="type-section text-v2-text-text-base">{language.t("secondBrain.github.repository")}</span>
            <span class="break-words type-meta text-v2-text-text-muted">
              {current()
                ? language.t(
                    current()!.source === "project"
                      ? "secondBrain.github.repoFromProject"
                      : "secondBrain.github.repoFromOrigin",
                    { repo: current()!.repo },
                  )
                : work.latest?.status === "no-gh"
                  ? language.t("secondBrain.github.noGh")
                  : work.latest?.status === "signed-out"
                    ? language.t("secondBrain.github.signedOut")
                    : work.latest?.status === "error"
                      ? language.t("secondBrain.github.failed", {
                          message: (work.latest as { message: string }).message,
                        })
                      : language.t("secondBrain.github.repoNone")}
            </span>
          </div>
          <ButtonV2
            size="small"
            variant="ghost"
            aria-expanded={edit.open}
            onClick={() => setEdit({ open: !edit.open, value: current()?.repo ?? "" })}
          >
            {language.t("secondBrain.github.change")}
          </ButtonV2>
        </div>
        <Show when={edit.open}>
          <form
            class="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <TextInputV2
              type="text"
              class="min-w-0 flex-1 font-mono"
              value={edit.value}
              placeholder={language.t("secondBrain.github.repositoryPlaceholder")}
              aria-label={language.t("secondBrain.github.repository")}
              onInput={(event) => setEdit("value", event.currentTarget.value)}
            />
            <ButtonV2 type="submit" size="small" variant="contrast" disabled={edit.busy}>
              {language.t("common.save")}
            </ButtonV2>
          </form>
        </Show>
      </section>
    </Show>
  )
}
