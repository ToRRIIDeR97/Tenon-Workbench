import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { createEffect, createMemo, createResource, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PermissionModeControl } from "@/components/prompt-input/permission-mode-pill"
import type { SidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { approvalQueue, type QueueItem } from "@/features/command-centre/approval-queue"
import { useCommandCentre } from "@/features/command-centre/command-centre"
import type { MissionThread } from "@/features/command-centre/mission-board-view"
import { rootThread } from "@/features/command-centre/thread-owner"
import { listCommandActions, type CommandAction } from "@/features/second-brain/client"
import { permissionSummary } from "@/pages/session/composer/permission-summary"
import { getRelativeTime } from "@/utils/time"

/** A queue item with the root thread it belongs to and the request itself, for what it asks and how to answer. */
export type WaitingRequest = {
  item: QueueItem
  root: MissionThread
  permission?: PermissionRequest
  question?: QuestionRequest
}

// Commands or paths shown before "Show N more", as in the thread's own approval card.
const VISIBLE = 3

/**
 * Every pending permission and question of the board's threads, subagents included, oldest first. It reads the
 * synced run data the thread pages and the board already read, so it adds no request.
 */
export function createWaitingQueue(ctrl: SidebarController, threads: () => MissionThread[]) {
  const serverSync = useServerSync()
  return createMemo<WaitingRequest[]>(() => {
    const data = serverSync().session.data
    const roots = new Map(threads().map((thread) => [thread.id, thread]))
    // Parents come from the synced store, then from the sidebar's index links, as the board's Needs you does.
    const links = ctrl.parentLinks()
    const owned = [...new Set([...Object.keys(data.permission), ...Object.keys(data.question)])].flatMap((id) => {
      const root = rootThread(id, roots, (child) => serverSync().session.get(child)?.parentID, links)
      return root ? [{ id, root }] : []
    })
    const rootByID = new Map(owned.map((entry) => [entry.id, entry.root]))
    return approvalQueue(
      owned.map((entry) => ({ id: entry.id, title: entry.root.title, project: entry.root.project })),
      data,
    ).flatMap((item): WaitingRequest[] => {
      const root = rootByID.get(item.sessionID)
      if (!root) return []
      return [
        {
          item,
          root,
          permission: data.permission[item.sessionID]?.find((request) => request.id === item.requestID),
          question: data.question[item.sessionID]?.find((request) => request.id === item.requestID),
        },
      ]
    })
  })
}

const startOfToday = () => new Date().setHours(0, 0, 0, 0)

/**
 * The Command Centre's "Waiting on you" view. Left: every request waiting on the user across the Projects, with
 * the answer buttons, and what may run without asking per Project. Right: what the Command Centre agent did to
 * other threads today. The user's own answers, Steer and Stop never appear in that log.
 */
export function AgentHands(props: { ctrl: SidebarController; queue: WaitingRequest[]; open: (id: string) => void }) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const permission = usePermission()
  const serverSDK = useServerSDK()
  const centre = useCommandCentre()
  const [state, setState] = createStore({
    answered: {} as Record<string, true>,
    busy: undefined as string | undefined,
    failed: undefined as string | undefined,
    all: {} as Record<string, true>,
  })
  const waiting = createMemo(() => props.queue.filter((entry) => !state.answered[entry.item.requestID]))

  const [done, { refetch }] = createResource(
    () => layout.home.workspace(),
    (workspace) =>
      listCommandActions(
        { server: serverSDK().server, fetch: platform.fetch, target: { directory: workspace } },
        startOfToday(),
      ).then(
        (items) => ({ items, failed: false }),
        () => ({ items: [] as CommandAction[], failed: true }),
      ),
  )
  // The log changes when a Command Centre thread acts, so read it again when one starts or ends a turn. No timer.
  createEffect(
    on(
      () =>
        centre
          .threads()
          .map((thread) => `${thread.id}:${centre.working(thread.id)}`)
          .join(","),
      () => void refetch(),
      { defer: true },
    ),
  )

  const time = createMemo(() => new Intl.DateTimeFormat(language.locale(), { timeStyle: "short" }))
  const ago = (ms: number) => getRelativeTime(new Date(ms).toISOString(), language.t)

  // The thread's own folder routes the reply, as it does from the thread's page.
  const answer = (entry: WaitingRequest, reply: "once" | "always" | "reject") => {
    if (state.busy) return
    setState({ busy: entry.item.requestID, failed: undefined })
    void serverSDK()
      .ensureDirSdkContext(entry.root.directory)
      .api.permission.reply({ sessionID: entry.item.sessionID, requestID: entry.item.requestID, reply })
      .then(
        () => setState({ busy: undefined, answered: { ...state.answered, [entry.item.requestID]: true } }),
        () => setState({ busy: undefined, failed: entry.item.requestID }),
      )
  }

  const Card = (card: { entry: WaitingRequest }) => {
    const entry = () => card.entry
    const summary = () => (entry().permission ? permissionSummary(entry().permission!) : undefined)
    const patterns = () => entry().permission?.patterns ?? []
    const shown = () => (state.all[entry().item.requestID] ? patterns() : patterns().slice(0, VISIBLE))
    const asked = () => (entry().item.asked > 0 ? entry().item.asked : entry().root.updated)
    return (
      <li
        data-request={entry().item.requestID}
        data-kind={entry().item.kind}
        data-risky={summary()?.risky ? "" : undefined}
        class="flex flex-col gap-3 rounded-[16px] px-4 py-3"
        classList={{
          "bg-v2-state-bg-warning": !!summary()?.risky,
          "bg-v2-background-bg-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]": !summary()?.risky,
        }}
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <h3
            class="min-w-0 truncate type-row-title"
            classList={{
              "text-v2-state-fg-warning": !!summary()?.risky,
              "text-v2-text-text-base": !summary()?.risky,
            }}
          >
            {language.t(
              entry().item.kind === "permission"
                ? "secondBrain.commandCentre.hands.permissionTitle"
                : "secondBrain.commandCentre.hands.questionTitle",
              { title: entry().item.title },
            )}
          </h3>
          <p class="flex min-w-0 items-center gap-2 type-meta text-v2-text-text-muted">
            <span class="min-w-0 truncate">{entry().item.project}</span>
            <span class="shrink-0">{ago(asked())}</span>
          </p>
        </div>
        <Show when={summary()}>
          {(value) => (
            <p class="type-body-compact text-v2-text-text-base">
              {language.plural(value().key, value().count, { count: value().count, tool: value().tool })}
            </p>
          )}
        </Show>
        <Show when={patterns().length > 0}>
          <div class="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-[12px] bg-v2-background-bg-layer-01 px-3 py-2">
            <For each={shown()}>
              {(pattern) => (
                <code class="font-mono text-[12px] leading-5 text-v2-text-text-base break-all">{pattern}</code>
              )}
            </For>
            <Show when={!state.all[entry().item.requestID] && patterns().length > VISIBLE}>
              <button
                type="button"
                class="self-start text-[12px] leading-5 text-v2-text-text-muted hover:text-v2-text-text-base"
                onClick={() => setState("all", entry().item.requestID, true)}
              >
                {language.t("secondBrain.permission.showMore", { count: patterns().length - VISIBLE })}
              </button>
            </Show>
          </div>
        </Show>
        <Show when={entry().question}>
          {(question) => (
            <p class="line-clamp-3 whitespace-pre-wrap type-body-compact text-v2-text-text-base">
              {question().questions[0]?.question}
            </p>
          )}
        </Show>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={entry().item.kind === "permission"}>
            <ButtonV2
              size="small"
              variant="contrast"
              data-action="queue-allow-once"
              disabled={state.busy === entry().item.requestID}
              onClick={() => answer(entry(), "once")}
            >
              {language.t("ui.permission.allowOnce")}
            </ButtonV2>
            <Show when={!summary()?.risky}>
              <ButtonV2
                size="small"
                variant="outline"
                data-action="queue-allow-always"
                disabled={state.busy === entry().item.requestID}
                onClick={() => answer(entry(), "always")}
              >
                {language.t("secondBrain.permission.always")}
              </ButtonV2>
            </Show>
            <ButtonV2
              size="small"
              variant="outline"
              data-action="queue-deny"
              disabled={state.busy === entry().item.requestID}
              onClick={() => answer(entry(), "reject")}
            >
              {language.t("ui.permission.deny")}
            </ButtonV2>
          </Show>
          <ButtonV2
            size="small"
            variant={entry().item.kind === "permission" ? "ghost" : "contrast"}
            data-action="queue-open"
            onClick={() => props.open(entry().root.id)}
          >
            {language.t("secondBrain.commandCentre.agent.openThread")}
          </ButtonV2>
        </div>
        <Show when={state.failed === entry().item.requestID}>
          <p role="alert" class="type-meta text-v2-text-text-critical">
            {language.t("common.requestFailed")}
          </p>
        </Show>
      </li>
    )
  }

  const verb = (action: CommandAction) =>
    language.t(
      action.kind === "message"
        ? "secondBrain.commandCentre.hands.steered"
        : action.kind === "stop"
          ? "secondBrain.commandCentre.hands.stopped"
          : "secondBrain.commandCentre.hands.started",
    )

  return (
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto @[900px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] @[900px]:overflow-hidden">
      <div class="flex min-h-0 min-w-0 flex-col gap-6 rounded-[16px] bg-v2-background-bg-layer-01 p-5 @[900px]:overflow-y-auto">
        <section
          data-component="approval-queue"
          aria-labelledby="approval-queue-title"
          class="flex min-w-0 flex-col gap-3"
        >
          <div class="flex flex-col gap-0.5 px-1">
            <h2 id="approval-queue-title" class="type-toolbar-title text-v2-text-text-base">
              {language.t("secondBrain.commandCentre.hands.waiting")}
            </h2>
            <p class="type-meta text-v2-text-text-muted">
              {language.t("secondBrain.commandCentre.hands.waiting.body")}
            </p>
          </div>
          <Show
            when={waiting().length > 0}
            fallback={
              <p class="px-1 type-body text-v2-text-text-muted">
                {language.t("secondBrain.commandCentre.hands.waiting.empty")}
              </p>
            }
          >
            <ul class="flex flex-col gap-3">
              {/* By request ID: a sync update rewrites a card in place instead of rebuilding the list. */}
              <For each={waiting().map((entry) => entry.item.requestID)}>
                {(id) => (
                  <Show when={waiting().find((entry) => entry.item.requestID === id)}>
                    {(entry) => <Card entry={entry()} />}
                  </Show>
                )}
              </For>
            </ul>
          </Show>
        </section>
        <Show when={props.ctrl.projects().length > 0}>
          <section data-component="project-modes" aria-labelledby="project-modes-title" class="flex flex-col gap-1">
            <h2 id="project-modes-title" class="px-1 pb-1 type-section text-v2-text-text-base">
              {language.t("secondBrain.commandCentre.hands.modes")}
            </h2>
            <ul class="flex flex-col">
              <For each={props.ctrl.projects()}>
                {(project) => (
                  <li data-project-mode={project.id} class="flex min-w-0 items-center gap-3 px-1 py-0.5">
                    <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">{project.name}</span>
                    <PermissionModeControl
                      mode={permission.mode(undefined, project.threadDirectory)}
                      onPick={(next) => permission.setMode(undefined, project.threadDirectory, next)}
                      label={language.t("secondBrain.commandCentre.hands.modeLabel", { project: project.name })}
                    />
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </div>
      <section
        data-component="command-actions"
        aria-labelledby="command-actions-title"
        class="flex min-h-0 min-w-0 flex-col gap-3 rounded-[16px] bg-v2-background-bg-layer-01 p-5 @[900px]:overflow-y-auto"
      >
        <div class="flex flex-col gap-0.5 px-1">
          <h2 id="command-actions-title" class="type-section text-v2-text-text-base">
            {language.t("secondBrain.commandCentre.hands.done")}
          </h2>
          <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.commandCentre.hands.done.body")}</p>
        </div>
        <Show when={done.latest?.failed}>
          <p role="alert" class="px-1 type-meta text-v2-text-text-critical">
            {language.t("common.requestFailed")}
          </p>
        </Show>
        <Show
          when={(done.latest?.items.length ?? 0) > 0}
          fallback={
            <Show when={!done.loading && !done.latest?.failed}>
              <p class="px-1 type-body text-v2-text-text-muted">
                {language.t("secondBrain.commandCentre.hands.done.empty")}
              </p>
            </Show>
          }
        >
          <ul class="flex flex-col">
            <For each={done.latest?.items ?? []}>
              {(action) => (
                <li data-action-entry={action.id} class="flex min-w-0 items-start gap-3 rounded-[8px] px-3 py-2">
                  <span class="w-16 shrink-0 pt-px type-meta tabular-nums text-v2-text-text-muted">
                    {time().format(new Date(action.at))}
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p class="min-w-0 truncate type-row-title text-v2-text-text-base">
                      <span class="[font-weight:600]">{verb(action)}</span> {action.title}
                    </p>
                    <Show when={action.text}>
                      <p class="line-clamp-2 whitespace-pre-wrap type-meta text-v2-text-text-muted">{action.text}</p>
                    </Show>
                  </div>
                  <ButtonV2
                    size="small"
                    variant="ghost"
                    data-action="command-action-open"
                    onClick={() => props.open(action.sessionID)}
                  >
                    {language.t("common.open")}
                  </ButtonV2>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  )
}
