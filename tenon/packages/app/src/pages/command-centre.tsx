import { A, useNavigate, useSearchParams } from "@solidjs/router"
import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createEffect, createResource, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame, PageHeader, pageRowClass } from "@/components/page"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { ComposerModelPill, createComposerHarness } from "@/components/prompt-input/composer-harness"
import { DialogArchivedThreads } from "@/components/sidebar/dialog-archived-threads"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { searchFieldClass } from "@/components/surface-classes"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { AgentHands, createWaitingQueue } from "@/features/command-centre/agent-hands-view"
import { useCommandCentre, type CommandThread } from "@/features/command-centre/command-centre"
import { createMissionThreads, MissionBoard } from "@/features/command-centre/mission-board-view"
import { Workflows } from "@/features/command-centre/workflows-view"
import { searchCommandMemory } from "@/features/second-brain/client"
import { sessionHref } from "@/utils/session-route"
import { getRelativeTime } from "@/utils/time"

/**
 * The Command Centre: its own threads (never Project threads), memory search, the link to Routines, the mission
 * board of every Project's threads (or, from the view switch, what waits on the user and what the agent did on
 * their behalf, or the saved workflows that start a director thread) and a composer that starts a fresh thread. A thread opens in the thread view, like a Project thread but without
 * review, files or terminal. `/command?thread=<session id>` (older links, the strip's "Open full") opens
 * that thread.
 */
export default function CommandCentrePage() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  const dialog = useDialog()
  // The provider outlives this page, so catch up on what changed while it was closed.
  onMount(() => void centre.refetch())
  const [search] = useSearchParams<{ thread?: string }>()
  const [state, setState] = createStore({
    memory: "",
    query: "",
    hit: -1,
    view: "board" as "board" | "waiting" | "workflows",
  })
  const open = (sessionID: string) => navigate(sessionHref(server.key, sessionID))
  const board = createMissionThreads(ctrl)
  const queue = createWaitingQueue(ctrl, board)
  createEffect(() => {
    if (search.thread) navigate(sessionHref(server.key, search.thread), { replace: true })
  })
  const [hits] = createResource(
    () => {
      const workspace = layout.home.workspace()
      return state.query && workspace ? { workspace, query: state.query } : undefined
    },
    (input) =>
      searchCommandMemory(
        { server: serverSDK().server, fetch: platform.fetch, target: { directory: input.workspace } },
        input.query,
      ).then(
        (items) => ({ items, failed: false }),
        () => ({ items: [], failed: true }),
      ),
  )

  // The pill starts on Settings › Command Centre's harness and model.
  const harness = createComposerHarness({
    scope: "command",
    directory: () => centre.directory() ?? "",
    initial: () => {
      const current = settings.commandCentre.current()
      return current.harnessID
        ? { harnessID: current.harnessID, model: current.modelID ? { id: current.modelID } : undefined }
        : undefined
    },
  })
  const composer = createComposerController({
    persist: "command",
    // Each request from here is a fresh thread; it opens once started. A failed send keeps the text.
    send: async (text) => {
      const id = await centre.send(text, null, {
        harnessID: harness.harnessID(),
        harnessModel: harness.harnessModel(),
        model: harness.builtInModel(),
      })
      if (!id) return false
      open(id)
      return true
    },
    disabled: () => !centre.directory(),
    blocked: () => centre.sending() || harness.waiting(),
  })

  return (
    <PageFrame labelledBy="command-centre-title" scroll={false}>
      <PageHeader
        id="command-centre-title"
        title={language.t("secondBrain.commandCentre.title")}
        actions={
          <>
            <Show when={centre.directory()}>
              {(directory) => (
                <ButtonV2
                  variant="ghost"
                  onClick={() => dialog.show(() => <DialogArchivedThreads ctrl={ctrl} directory={directory()} />)}
                >
                  {language.t("secondBrain.sidebar.archivedThreads")}
                </ButtonV2>
              )}
            </Show>
            <ButtonV2 variant="ghost" icon="refresh" onClick={() => navigate("/routines")}>
              {language.t("secondBrain.routines.title")}
            </ButtonV2>
          </>
        }
      />
      <div class="flex min-h-0 flex-1 gap-2 px-3 pb-3">
        <aside class="flex w-[260px] shrink-0 flex-col gap-2 overflow-y-auto">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setState({ query: state.memory.trim(), hit: -1 })
            }}
          >
            <label class="relative block">
              <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-v2-icon-icon-muted">
                <Icon name="magnifying-glass" size="small" />
              </span>
              <input
                type="search"
                class={searchFieldClass}
                placeholder={language.t("secondBrain.commandCentre.memory.placeholder")}
                aria-label={language.t("secondBrain.commandCentre.memory.label")}
                value={state.memory}
                onInput={(event) => {
                  const memory = event.currentTarget.value
                  setState(memory.trim() ? { memory } : { memory, query: "", hit: -1 })
                }}
              />
            </label>
          </form>
          <Show when={state.query}>
            <Show
              when={!hits.loading}
              fallback={
                <p role="status" class="px-3 type-meta text-v2-text-text-muted">
                  {language.t("secondBrain.commandCentre.memory.searching")}
                </p>
              }
            >
              <ul class="flex flex-col gap-1" aria-label={language.t("secondBrain.commandCentre.memory.results")}>
                <For
                  each={hits()?.items ?? []}
                  fallback={
                    <li role={hits()?.failed ? "alert" : undefined} class="px-3 type-meta text-v2-text-text-muted">
                      {language.t(hits()?.failed ? "common.requestFailed" : "secondBrain.commandCentre.memory.empty")}
                    </li>
                  }
                >
                  {(hit, index) => (
                    <li>
                      {/* A hit from a live thread opens it; a summary (its thread was compacted) expands in place. */}
                      <button
                        type="button"
                        class={`${pageRowClass} !py-1.5`}
                        aria-expanded={hit.sessionID ? undefined : state.hit === index()}
                        onClick={() => {
                          if (hit.sessionID) return open(hit.sessionID)
                          setState("hit", state.hit === index() ? -1 : index())
                        }}
                      >
                        <span
                          class="min-w-0 flex-1 whitespace-pre-wrap type-meta text-v2-text-text-muted"
                          classList={{ "line-clamp-2": state.hit !== index() }}
                        >
                          {hit.text}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
          <Show
            when={centre.threads().length > 0}
            fallback={
              <p role={centre.loading() ? "status" : undefined} class="px-3 py-2 type-meta text-v2-text-text-muted">
                {centre.loading()
                  ? language.t("common.loading")
                  : language.t("secondBrain.commandCentre.threads.empty")}
              </p>
            }
          >
            <ul class="flex flex-col gap-0.5" aria-label={language.t("secondBrain.commandCentre.threads")}>
              {/* By ID: a refresh rebuilds the thread objects, which must not end a rename in progress. */}
              <For each={centre.threads().flatMap((thread) => (ctrl.threadHidden(thread.id) ? [] : [thread.id]))}>
                {(id) => (
                  <Show when={centre.threads().find((thread) => thread.id === id)}>
                    {(thread) => <ThreadRow thread={thread()} href={sessionHref(server.key, id)} />}
                  </Show>
                )}
              </For>
            </ul>
          </Show>
        </aside>
        <div class="@container flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden rounded-[16px] bg-v2-background-bg-layer-01 py-6">
          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
            <div class="mx-auto flex w-full max-w-[1040px] flex-col gap-4">
              <SegmentedControlV2
                aria-label={language.t("secondBrain.commandCentre.hands.view")}
                value={state.view}
                onChange={(value) => setState("view", value === "waiting" || value === "workflows" ? value : "board")}
              >
                <SegmentedControlItemV2 value="board" data-action="command-view">
                  {language.t("secondBrain.commandCentre.board.title")}
                </SegmentedControlItemV2>
                <SegmentedControlItemV2 value="waiting" data-action="command-view">
                  {language.t("secondBrain.commandCentre.hands.waiting")}
                  <Show when={queue().length > 0}>
                    <span class="ml-1.5 tabular-nums">{queue().length}</span>
                  </Show>
                </SegmentedControlItemV2>
                <SegmentedControlItemV2 value="workflows" data-action="command-view">
                  {language.t("secondBrain.workflows.title")}
                </SegmentedControlItemV2>
              </SegmentedControlV2>
              <Switch>
                <Match when={state.view === "workflows"}>
                  <Workflows ctrl={ctrl} started={() => setState("view", "board")} />
                </Match>
                <Match when={state.view === "waiting"}>
                  <AgentHands ctrl={ctrl} queue={queue()} open={open} />
                </Match>
                <Match when={true}>
                  <Show
                    when={centre.loading() || centre.threads().length > 0 || board().length > 0}
                    fallback={
                      <PageEmpty title={language.t("secondBrain.commandCentre.empty.title")}>
                        {language.t("secondBrain.commandCentre.empty.body")}
                      </PageEmpty>
                    }
                  >
                    <MissionBoard ctrl={ctrl} threads={board()} open={open} />
                  </Show>
                </Match>
              </Switch>
            </div>
          </div>
          <div class="flex shrink-0 flex-col items-center gap-3 px-6">
            <ComposerBox
              size="large"
              class="w-full max-w-[720px]"
              controller={composer}
              label={language.t("secondBrain.commandCentre.composer.label")}
              placeholder={language.t("secondBrain.commandCentre.composer.placeholder")}
              sendLabel={language.t("secondBrain.commandCentre.composer.send")}
              controls={<ComposerModelPill harness={harness} />}
            />
            <Show when={centre.error()}>
              <p role="alert" class="type-meta text-v2-text-text-critical">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </div>
        </div>
      </div>
    </PageFrame>
  )
}

/** A Command Centre thread: opens on click, with the sidebar's rename, archive and delete in a "…" menu. */
function ThreadRow(props: { thread: CommandThread; href: string }) {
  const language = useLanguage()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  const [editing, setEditing] = createSignal(false)
  const label = () => centre.label(props.thread)
  let input: HTMLInputElement | undefined
  // The menu stays mounted during an edit: the input takes focus when the menu closes, and closing returns focus
  // to the "…" trigger, which would blur an already focused input and end the edit straight away.
  const finish = (value: string | undefined) => {
    if (!editing()) return
    setEditing(false)
    if (value !== undefined) void ctrl.renameThread(props.thread.session, value)
  }

  return (
    <li class="group/row relative">
      <Show
        when={!editing()}
        fallback={
          <input
            ref={input}
            class="h-9 w-full min-w-0 rounded-full bg-v2-background-bg-layer-01 pl-3 pr-9 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_1px_var(--v2-border-border-base)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
            value={label()}
            aria-label={language.t("secondBrain.sidebar.renameThread")}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") finish(event.currentTarget.value)
              if (event.key === "Escape") finish(undefined)
            }}
            onBlur={(event) => finish(event.currentTarget.value)}
          />
        }
      >
        <A href={props.href} class={`${pageRowClass} group-hover/row:pr-10 group-focus-within/row:pr-10`}>
          <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
            {label() || language.t("secondBrain.commandCentre.threads.untitled")}
          </span>
          <Show
            when={centre.working(props.thread.id)}
            fallback={
              <span class="shrink-0 type-caption text-v2-text-text-muted">
                {getRelativeTime(new Date(props.thread.updated).toISOString(), language.t)}
              </span>
            }
          >
            <span
              class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
              role="img"
              aria-label={language.t("secondBrain.commandCentre.working")}
            />
          </Show>
        </A>
      </Show>
      <div class="absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
        <MenuV2 gutter={4} modal={false} placement="bottom-start">
          <MenuV2.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="small"
            icon={<Icon name="outline-dots" size="small" />}
            aria-label={language.t("secondBrain.sidebar.threadActions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content
              onCloseAutoFocus={() => {
                // Kobalte focuses the trigger right after this handler, so the input takes focus in a microtask.
                if (!editing()) return
                queueMicrotask(() => {
                  input?.focus()
                  input?.select()
                })
              }}
            >
              <MenuV2.Item onSelect={() => setEditing(true)}>{language.t("common.rename")}</MenuV2.Item>
              <MenuV2.Item onSelect={() => void ctrl.archiveThread(props.thread.session)}>
                {language.t("common.archive")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => ctrl.deleteThread(props.thread.session)}>
                {language.t("common.delete")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    </li>
  )
}
