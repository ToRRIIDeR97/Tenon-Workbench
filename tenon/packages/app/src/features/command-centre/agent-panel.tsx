import { A } from "@solidjs/router"
import { Markdown } from "@tenon/session-ui/markdown"
import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { pageRowClass } from "@/components/page"
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
import { useCommandCentre, type CommandThread } from "@/features/command-centre/command-centre"
import { searchCommandMemory } from "@/features/second-brain/client"
import { sessionHref } from "@/utils/session-route"
import { getRelativeTime } from "@/utils/time"

/**
 * The Command Centre agent beside the board: the latest exchange of its newest thread (your last message and the
 * reply as Markdown) and a composer that replies to that thread, as the card on other pages does. New thread makes
 * the next send start a fresh thread on the model pill's harness. Threads swaps the conversation for memory search
 * and the list of the Command Centre's own threads, each with rename, archive and delete.
 */
export function AgentPanel(props: { open: (sessionID: string) => void }) {
  const language = useLanguage()
  const settings = useSettings()
  const centre = useCommandCentre()
  // `fresh`: the next send starts a new thread. `threads`: the thread list and memory search replace the chat.
  const [state, setState] = createStore({ fresh: false, threads: false })
  const shown = () => !state.fresh && !!centre.latest()
  let input: HTMLTextAreaElement | undefined

  // The pill starts on Settings › Command Centre's harness and model and applies to the next send. It stays
  // mounted while replying: its folder model list is also what loads the folder's pending approvals here.
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
    // A reply lands in the shown thread, so "yes, do it" goes where the question was asked. A failed send keeps
    // the text.
    send: async (text) => {
      const id = await centre.send(text, shown() ? centre.latest()?.id : null, {
        harnessID: harness.harnessID(),
        harnessModel: harness.harnessModel(),
        model: harness.builtInModel(),
      })
      if (!id) return false
      setState({ fresh: false, threads: false })
      return true
    },
    disabled: () => !centre.directory(),
    blocked: () => centre.sending() || harness.waiting(),
  })

  const title = () =>
    shown()
      ? centre.label(centre.latest()!) || language.t("secondBrain.commandCentre.threads.untitled")
      : language.t("secondBrain.commandCentre.strip.newThread")

  return (
    <section
      data-component="command-agent"
      aria-labelledby="command-agent-title"
      class="flex min-h-0 min-w-0 flex-col gap-3 rounded-[16px] bg-v2-background-bg-layer-01 p-4"
    >
      <div class="flex min-h-9 min-w-0 items-center gap-1">
        <h2 id="command-agent-title" class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
          {state.threads ? language.t("secondBrain.commandCentre.threads") : title()}
        </h2>
        <ButtonV2
          size="small"
          variant="ghost-muted"
          data-action="command-agent-threads"
          aria-pressed={state.threads}
          onClick={() => setState("threads", (value) => !value)}
        >
          {language.t(
            state.threads ? "secondBrain.commandCentre.agent.conversation" : "secondBrain.commandCentre.agent.threads",
          )}
        </ButtonV2>
        <ButtonV2
          size="small"
          variant="ghost-muted"
          icon="plus"
          data-action="command-card-new"
          onClick={() => {
            setState({ fresh: true, threads: false })
            queueMicrotask(() => input?.focus())
          }}
        >
          {language.t("secondBrain.commandCentre.strip.newThread")}
        </ButtonV2>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <Show when={state.threads} fallback={<Conversation shown={shown()} open={props.open} />}>
          <ThreadList open={props.open} />
        </Show>
      </div>

      <div class="flex shrink-0 flex-col gap-2">
        <p class="px-1 type-caption text-v2-text-text-muted">{language.t("secondBrain.commandCentre.agent.caption")}</p>
        <ComposerBox
          ref={(element) => (input = element)}
          controller={composer}
          label={language.t("secondBrain.commandCentre.composer.label")}
          placeholder={language.t(
            shown() ? "secondBrain.commandCentre.strip.reply" : "secondBrain.commandCentre.composer.placeholder",
          )}
          sendLabel={language.t("secondBrain.commandCentre.composer.send")}
          controls={<ComposerModelPill harness={harness} />}
        />
        <Show when={centre.error()}>
          <p role="alert" class="px-1 type-meta text-v2-text-text-critical">
            {language.t("common.requestFailed")}
          </p>
        </Show>
      </div>
    </section>
  )
}

/** The newest thread's last ask and reply, with Undo for that reply's last write and the thread's waiting state. */
function Conversation(props: { shown: boolean; open: (sessionID: string) => void }) {
  const language = useLanguage()
  const centre = useCommandCentre()
  return (
    <Show
      when={props.shown}
      fallback={
        <div class="flex flex-col gap-1 px-1 py-2">
          <p class="type-row-title text-v2-text-text-base">{language.t("secondBrain.commandCentre.empty.title")}</p>
          <p class="type-body text-v2-text-text-muted">{language.t("secondBrain.commandCentre.empty.body")}</p>
        </div>
      }
    >
      <Show when={centre.lastAsk()}>
        {(ask) => (
          <div
            data-slot="command-agent-ask"
            class="flex min-w-0 flex-col gap-0.5 rounded-[16px] bg-v2-overlay-simple-overlay-hover px-3.5 py-2.5"
          >
            <span class="type-caption text-v2-text-text-muted">
              {language.t("secondBrain.commandCentre.strip.you")}
            </span>
            <p class="m-0 whitespace-pre-wrap text-[13px] leading-5 text-v2-text-text-base">{ask()}</p>
          </div>
        )}
      </Show>
      <Show
        when={centre.lastReply()}
        fallback={
          <p class="m-0 px-1 text-[13px] leading-5 text-v2-text-text-muted">
            {language.t(
              centre.working(centre.latest()?.id ?? "")
                ? "secondBrain.commandCentre.working"
                : "secondBrain.commandCentre.strip.empty",
            )}
          </p>
        }
      >
        <div
          data-slot="command-agent-reply"
          class="min-w-0 px-1 text-[13px] leading-[21px] text-v2-text-text-base [&_li]:my-0 [&_li>p]:my-0 [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        >
          <Markdown text={centre.lastReply()} class="text-[13px]" />
        </div>
      </Show>
      <Show when={centre.waiting()}>
        <div class="flex min-w-0 items-center gap-2 rounded-[16px] bg-v2-state-bg-warning px-3 py-1.5">
          <span class="min-w-0 flex-1 text-[13px] leading-5 text-v2-state-fg-warning">
            {language.t("secondBrain.commandCentre.strip.waiting")}
          </span>
          <ButtonV2
            size="small"
            variant="outline"
            data-action="command-card-review"
            onClick={() => props.open(centre.latest()!.id)}
          >
            {language.t("secondBrain.commandCentre.strip.review")}
          </ButtonV2>
        </div>
      </Show>
      <div class="flex flex-wrap items-center gap-2 px-1">
        <ButtonV2
          size="small"
          variant="outline"
          data-action="command-agent-open"
          onClick={() => props.open(centre.latest()!.id)}
        >
          {language.t("secondBrain.commandCentre.agent.openThread")}
        </ButtonV2>
        <Show when={centre.lastWrite()} keyed>
          {(write) => (
            <Show
              when={write.undoState === "idle" || write.undoState === "pending"}
              fallback={
                <span class="type-meta text-v2-text-text-muted" role="status">
                  {language.t(
                    write.undoState === "undone"
                      ? "secondBrain.agentWrites.undone"
                      : write.undoState === "changed"
                        ? "secondBrain.agentWrites.changed"
                        : "secondBrain.agentWrites.undoFailed",
                  )}
                </span>
              }
            >
              <ButtonV2
                size="small"
                variant="ghost"
                data-action="command-agent-undo"
                disabled={write.undoState === "pending"}
                onClick={() => void centre.undo(write.id)}
              >
                {language.t("secondBrain.agentWrites.undo")}
              </ButtonV2>
            </Show>
          )}
        </Show>
      </div>
    </Show>
  )
}

/** Memory search, the Command Centre's own threads and the archived ones. */
function ThreadList(props: { open: (sessionID: string) => void }) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  const dialog = useDialog()
  const [state, setState] = createStore({ memory: "", query: "", hit: -1 })
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

  return (
    <>
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
                      if (hit.sessionID) return props.open(hit.sessionID)
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
            {centre.loading() ? language.t("common.loading") : language.t("secondBrain.commandCentre.threads.empty")}
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
      <Show when={centre.directory()}>
        {(directory) => (
          <div>
            <ButtonV2
              size="small"
              variant="ghost"
              icon="archive"
              onClick={() => dialog.show(() => <DialogArchivedThreads ctrl={ctrl} directory={directory()} />)}
            >
              {language.t("secondBrain.sidebar.archivedThreads")}
            </ButtonV2>
          </div>
        )}
      </Show>
    </>
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
