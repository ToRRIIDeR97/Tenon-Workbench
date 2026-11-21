import { useLocation, useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Markdown } from "@tenon/session-ui/markdown"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { ComposerModelPill, createComposerHarness } from "@/components/prompt-input/composer-harness"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { formatKeybind, useCommand } from "@/context/command"
import { useSettings } from "@/context/settings"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { permissionSummary } from "@/pages/session/composer/permission-summary"
import { createWaitingQueue, type WaitingRequest } from "./agent-hands-view"
import { BRIEFING_RUNNING, commandBriefing } from "./command-briefing"
import { createMissionThreads } from "./mission-board-view"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import { useCommandCentre } from "./command-centre"
import { commandStripAnchor, commandStripStyle } from "./command-strip-anchor"
import { runsOnLabel, stripTarget } from "./command-strip-target"
import { commandBackState } from "./thread-back"

/**
 * The Command Centre card, a briefing. A handle just above the bottom edge of every page but the Command Centre;
 * Ctrl/Cmd+J or a click raises a 640px card named "Command Centre" with, in order: the counts (running, needs
 * you, done today); the oldest request waiting on you, answered right there (Allow, Deny) or opened (a question);
 * the running threads with their checklist step and progress; then the latest exchange (your last message and the
 * reply drawn as Markdown, capped at about five lines with "Show more"), Undo when that reply made a write, "Open full", and a composer that replies to the shown
 * thread (New thread starts a fresh one). An approval or question on that thread is answered in the thread, so the
 * card offers "Review in thread". The draft is the Command Centre page's. Esc hides it. The card rises and fades in
 * over 300 ms emphasized-decelerate and drops out over 200 ms emphasized-accelerate; reduced motion snaps.
 */
/** Recent threads the card's thread menu lists. */
const THREAD_MENU = 8

export function CommandStrip() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  // Back in the opened thread returns to wherever the strip was opened over.
  const back = () => ({ state: commandBackState(location.pathname + location.search) })
  const command = useCommand()
  const centre = useCommandCentre()
  const server = useServer()
  // `fresh`: New thread was chosen, so the next send starts a thread instead of replying to the shown one.
  // `chosen`: the thread picked in the thread menu (#329); the newest when it is gone or none was picked.
  // `expanded`: Show more was chosen for the reply on show; `overflow`: that reply is taller than the cap.
  const [state, setState] = createStore({
    open: false,
    fresh: false,
    chosen: undefined as string | undefined,
    expanded: false,
    overflow: false,
    /** The request being answered, and requests answered from here (the queue drops them on the next sync). */
    busy: undefined as string | undefined,
    answered: {} as Record<string, true>,
  })
  const settings = useSettings()
  // The thread the card shows and replies to, and what it runs on (#329).
  const targetID = createMemo(() => stripTarget(state.fresh ? null : state.chosen, centre.threads(), centre.latest()?.id))
  const target = () => centre.threads().find((thread) => thread.id === targetID())
  const lastReply = createMemo(() => centre.replyOf(targetID() ?? undefined))
  const lastAsk = createMemo(() => centre.askOf(targetID() ?? undefined))
  const waitingHere = () => centre.waitingOn(targetID() ?? undefined)
  // A new thread starts on the pill's harness and model; the page's composer shares the list and the choice.
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
  const runsOn = () => {
    const thread = target()
    if (!thread) return ""
    return runsOnLabel({
      harnessID: thread.session.harnessInstanceID ?? "",
      harnessModel: thread.session.harnessModel,
      defaultModel: settings.commandCentre.current().modelID,
      instances: harness.controller.instances(),
    })
  }
  const shortcut = () => formatKeybind("mod+j")
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const ctrl = useSidebarController()
  const board = createMissionThreads(ctrl)
  const queue = createWaitingQueue(ctrl, board)
  const waiting = createMemo(() => queue().filter((entry) => !state.answered[entry.item.requestID]))
  const brief = createMemo(() =>
    state.open ? commandBriefing(board(), (id) => serverSync().session.data.todo[id], Date.now()) : undefined,
  )
  // A running thread's checklist is loaded once the card shows it; live updates arrive as todo.updated events.
  createEffect(() => {
    for (const run of brief()?.running.slice(0, BRIEFING_RUNNING) ?? []) void serverSync().session.todo(run.thread.id)
  })
  // The thread's own folder routes the reply, as it does from the thread's page and the Waiting view.
  const answer = (entry: WaitingRequest, reply: "once" | "reject") => {
    if (state.busy) return
    setState("busy", entry.item.requestID)
    void serverSDK()
      .ensureDirSdkContext(entry.root.directory)
      .api.permission.reply({ sessionID: entry.item.sessionID, requestID: entry.item.requestID, reply })
      .then(
        () => setState({ busy: undefined, answered: { ...state.answered, [entry.item.requestID]: true } }),
        () => setState("busy", undefined),
      )
  }
  const openThread = (id: string) => {
    setState("open", false)
    navigate(sessionHref(server.key, id), back())
  }
  let input: HTMLTextAreaElement | undefined
  let card: HTMLDivElement | undefined
  let full: HTMLButtonElement | undefined
  // Focus goes back where it was when the strip closes, so keyboard users are not dropped on <body>.
  let returnFocus: HTMLElement | undefined
  let reply: HTMLDivElement | undefined
  const measureReply = () => {
    if (!reply || state.expanded) return
    setState("overflow", reply.scrollHeight > reply.clientHeight + 1)
  }
  createResizeObserver(() => reply, measureReply)
  // A new reply, or the card closing, goes back to the capped view.
  createEffect(
    on([lastReply, () => state.open], () => {
      setState("expanded", false)
      queueMicrotask(measureReply)
    }),
  )

  const toggle = () => setState("open", (open) => !open)
  command.register("command-strip", () => [
    {
      id: "commandCentre.strip.toggle",
      title: language.t("secondBrain.commandCentre.strip.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+j",
      onSelect: toggle,
    },
  ])
  createEffect(() => {
    if (state.open) {
      // An old failure shouldn't hide the latest reply.
      centre.clearError()
      if (!card?.contains(document.activeElement)) returnFocus = document.activeElement as HTMLElement | undefined
      // A disabled input (no workspace yet) can't take focus; "Open full" can.
      queueMicrotask(() => (input && !input.disabled ? input : full)?.focus())
      return
    }
    // Making the card inert can already have dropped focus to <body>.
    if (document.activeElement !== document.body && !card?.contains(document.activeElement)) return
    const target = returnFocus?.isConnected ? returnFocus : undefined
    returnFocus = undefined
    if (target) target.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  })
  makeEventListener(window, "keydown", (event) => {
    if (event.key !== "Escape" || !state.open || event.defaultPrevented) return
    event.preventDefault()
    setState("open", false)
  })

  // A send replies to the thread the card shows, so "yes, do it" lands where the question was asked. The text
  // stays if sending fails; the draft is shared with the Command Centre page.
  const composer = createComposerController({
    send: async (text) => {
      // A reply runs on its thread's harness; only a new thread takes the pill's pick.
      const id = targetID()
      const sent = await centre.send(
        text,
        id,
        id
          ? undefined
          : { harnessID: harness.harnessID(), harnessModel: harness.harnessModel(), model: harness.builtInModel() },
      )
      if (sent) setState({ fresh: false, chosen: sent })
      return !!sent
    },
    disabled: () => !centre.directory(),
    blocked: () => centre.sending() || (!targetID() && harness.waiting()),
    persist: "command",
  })
  const shown = () => !!targetID()
  const startNew = () => {
    setState("fresh", true)
    queueMicrotask(() => input?.focus())
  }
  const pick = (id: string) => {
    setState({ fresh: false, chosen: id })
    queueMicrotask(() => input?.focus())
  }
  const openFull = () => {
    const id = targetID()
    setState("open", false)
    navigate(id ? sessionHref(server.key, id) : "/command", id ? back() : undefined)
  }

  return (
    // Sits on the page panel's bottom edge (main ends 8px below the panel). The handle stays in place and
    // the strip rises from it as a floating card, so nothing swaps or clips mid-animation.
    <div
      data-command-strip
      data-state={state.open ? "open" : "closed"}
      // Only the handle and the open card take the pointer; the rest of the band stays the page's.
      // On a thread the composer owns the page's bottom edge, so the strip sits on top of it, centred on the
      // chat column (the composer region publishes its anchor) rather than the whole window.
      class="pointer-events-none absolute z-(--z-command-strip) h-5 -translate-x-1/2"
      style={commandStripStyle(commandStripAnchor())}
    >
      <button
        type="button"
        tabIndex={state.open ? -1 : undefined}
        classList={{
          "group mx-auto flex h-5 w-28 items-center justify-center rounded-t-[10px] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:duration-0": true,
          "opacity-0 duration-short ease-standard": state.open,
          "pointer-events-auto opacity-100 duration-medium ease-standard": !state.open,
        }}
        aria-label={language.t("secondBrain.commandCentre.strip.open")}
        aria-keyshortcuts="Control+J Meta+J"
        title={language.t("secondBrain.commandCentre.strip.openShortcut", { shortcut: shortcut() })}
        aria-hidden={state.open ? true : undefined}
        onClick={() => setState("open", true)}
      >
        <span class="h-1 w-12 rounded-full bg-v2-border-border-strong transition-colors duration-short ease-standard group-hover:bg-v2-icon-icon-muted motion-reduce:transition-none" />
      </button>
      <div
        data-command-strip-card
        ref={card}
        inert={state.open ? undefined : true}
        classList={{
          "absolute inset-x-0 bottom-1.5 origin-bottom motion-reduce:duration-0": true,
          // Visibility isn't transitioned on open: at the transition's first frame it still reads hidden, and the
          // field couldn't take focus.
          "pointer-events-auto translate-y-0 scale-100 opacity-100 transition-[opacity,translate,scale] duration-medium ease-emphasized-decelerate":
            state.open,
          // Hidden once the exit finishes (visibility flips at the end), so the closed card's input is not
          // reachable by role queries, assistive tech or clicks.
          "invisible translate-y-3 scale-[0.97] opacity-0 transition-[opacity,translate,scale,visibility] duration-exit ease-emphasized-accelerate":
            !state.open,
        }}
      >
        <div
          role="dialog"
          aria-label={language.t("secondBrain.commandCentre.strip.title")}
          class="flex flex-col gap-2 rounded-[24px] bg-v2-background-bg-floating p-3 shadow-[var(--v2-elevation-floating)]"
        >
          <div class="flex h-7 min-w-0 items-center gap-0.5 pl-2">
            <span
              data-slot="command-card-title"
              class="shrink-0 text-[13px] leading-5 [font-weight:600] text-v2-text-text-base"
            >
              {language.t("secondBrain.commandCentre.strip.title")}
            </span>
            <kbd
              data-slot="command-card-shortcut"
              class="ml-1.5 shrink-0 rounded-[6px] bg-v2-background-bg-layer-02 px-1.5 font-sans text-[11px] leading-5 text-v2-text-text-muted"
            >
              {shortcut()}
            </kbd>
            <span
              data-slot="command-card-counts"
              class="ml-1.5 min-w-0 flex-1 truncate type-meta text-v2-text-text-muted"
            >
              {/* An expression, not a <Show> callback, which would compute the text once and keep it. */}
              {brief()
                ? language.t("secondBrain.commandCentre.strip.counts", {
                    running: brief()!.counts.running,
                    waiting: waiting().length,
                    done: brief()!.counts.done,
                  })
                : ""}
            </span>
            {/* Undo for the latest reply's last write; after it the button reports how that went. */}
            <Show when={shown() ? centre.lastWriteOf(targetID() ?? undefined) : undefined} keyed>
              {(write) => (
                <Show
                  when={write.undoState === "idle" || write.undoState === "pending"}
                  fallback={
                    <span class="shrink-0 type-meta text-v2-text-text-muted" role="status">
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
                    variant="ghost-muted"
                    data-action="command-strip-undo"
                    disabled={write.undoState === "pending"}
                    onClick={() => void centre.undo(write.id)}
                  >
                    {language.t("secondBrain.agentWrites.undo")}
                  </ButtonV2>
                </Show>
              )}
            </Show>
            {/* The thread the card replies to: recent Command Centre threads, or a new one. */}
            <MenuV2 gutter={4} modal={false} placement="bottom-end">
              <MenuV2.Trigger
                as={ButtonV2}
                size="small"
                variant="ghost-muted"
                data-action="command-card-threads"
                aria-label={language.t("secondBrain.commandCentre.strip.threadMenu")}
              >
                <span class="max-w-40 truncate">
                  {target()
                    ? centre.label(target()!) || language.t("secondBrain.commandCentre.threads.untitled")
                    : language.t("secondBrain.commandCentre.strip.newThread")}
                </span>
                <Icon name="chevron-down" size="small" />
              </MenuV2.Trigger>
              <MenuV2.Portal>
                <MenuV2.Content class="max-w-80">
                  <For each={centre.threads().slice(0, THREAD_MENU)}>
                    {(thread) => (
                      <MenuV2.Item onSelect={() => pick(thread.id)}>
                        <span class="min-w-0 flex-1 truncate">
                          {centre.label(thread) || language.t("secondBrain.commandCentre.threads.untitled")}
                        </span>
                        <Show when={centre.working(thread.id)}>
                          <span class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse" />
                        </Show>
                      </MenuV2.Item>
                    )}
                  </For>
                  <MenuV2.Item data-action="command-card-new" onSelect={startNew}>
                    {language.t("secondBrain.commandCentre.strip.newThread")}
                  </MenuV2.Item>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
            <ButtonV2 ref={full} size="small" variant="ghost-muted" onClick={openFull}>
              {language.t("secondBrain.commandCentre.strip.openFull")}
            </ButtonV2>
          </div>
          {/* What needs you: the oldest request, answered here; the rest are one click away in Waiting on you. */}
          <Show when={waiting()[0]} keyed>
            {(entry) => {
              const summary = entry.permission ? permissionSummary(entry.permission) : undefined
              return (
                <div
                  data-slot="command-card-needs"
                  data-kind={entry.item.kind}
                  class="flex min-w-0 items-center gap-2 rounded-[16px] bg-v2-state-bg-warning py-1.5 pl-3.5 pr-1.5"
                >
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="min-w-0 truncate text-[13px] leading-5 [font-weight:500] text-v2-state-fg-warning">
                      {language.t("secondBrain.commandCentre.strip.needsTitle", {
                        title: entry.root.title,
                        project: entry.item.project,
                      })}
                    </span>
                    <span class="min-w-0 truncate type-meta text-v2-text-text-base">
                      {summary
                        ? language.plural(summary.key, summary.count, { count: summary.count, tool: summary.tool })
                        : (entry.question?.questions[0]?.question ?? entry.item.title)}
                    </span>
                  </div>
                  <Show when={waiting().length > 1}>
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      data-action="command-card-waiting"
                      onClick={() => {
                        setState("open", false)
                        navigate("/command?view=waiting")
                      }}
                    >
                      {language.t("secondBrain.commandCentre.strip.moreWaiting", { count: waiting().length - 1 })}
                    </ButtonV2>
                  </Show>
                  <Show
                    when={entry.item.kind === "permission"}
                    fallback={
                      <ButtonV2 size="small" variant="contrast" onClick={() => openThread(entry.root.id)}>
                        {language.t("secondBrain.commandCentre.strip.answer")}
                      </ButtonV2>
                    }
                  >
                    <ButtonV2
                      size="small"
                      variant="outline"
                      data-action="command-card-deny"
                      disabled={state.busy === entry.item.requestID}
                      onClick={() => answer(entry, "reject")}
                    >
                      {language.t("ui.permission.deny")}
                    </ButtonV2>
                    <ButtonV2
                      size="small"
                      variant="contrast"
                      data-action="command-card-allow"
                      disabled={state.busy === entry.item.requestID}
                      onClick={() => answer(entry, "once")}
                    >
                      {language.t("ui.permission.allowOnce")}
                    </ButtonV2>
                  </Show>
                </div>
              )
            }}
          </Show>
          {/* What's running, newest first, with the checklist step it is on and how far it is. */}
          <Show when={brief()?.running.length ? brief() : undefined}>
            {(value) => (
              <ul data-slot="command-card-running" class="m-0 flex list-none flex-col p-0 px-1">
                <For each={value().running.slice(0, BRIEFING_RUNNING)}>
                  {(run) => (
                    <li class="flex min-w-0 flex-col gap-1 py-1.5">
                      <button
                        type="button"
                        class="flex min-w-0 items-center gap-2 rounded-[8px] text-left text-[13px] leading-5 outline-none focus-visible:shadow-[0_0_0_2px_var(--v2-border-border-focus)]"
                        onClick={() => openThread(run.thread.id)}
                      >
                        <span
                          aria-hidden="true"
                          class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
                        />
                        <span class="min-w-0 truncate [font-weight:500] text-v2-text-text-base">
                          {run.thread.title}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-v2-text-text-muted">{run.thread.project}</span>
                        <Show when={run.total > 0}>
                          <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">
                            {language.t("secondBrain.commandCentre.strip.steps", { done: run.done, total: run.total })}
                          </span>
                        </Show>
                      </button>
                      <Show when={run.step}>
                        {(step) => (
                          <span class="min-w-0 truncate pl-4 type-meta text-v2-text-text-muted">{step()}</span>
                        )}
                      </Show>
                      <Show when={run.total > 0}>
                        <div class="ml-4 h-[3px] overflow-hidden rounded-full bg-v2-background-bg-layer-02">
                          <div
                            class="h-full rounded-full bg-v2-icon-icon-accent transition-[width] duration-medium ease-emphasized-decelerate motion-reduce:transition-none"
                            style={{ width: `${Math.round((run.done / run.total) * 100)}%` }}
                          />
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
                <Show when={value().running.length > BRIEFING_RUNNING}>
                  <li class="pl-4 type-meta text-v2-text-text-muted">
                    {language.t("secondBrain.commandCentre.strip.moreRunning", {
                      count: value().running.length - BRIEFING_RUNNING,
                    })}
                  </li>
                </Show>
              </ul>
            )}
          </Show>
          <Show when={shown()}>
            <div class="flex min-w-0 flex-col gap-2.5 px-1">
              <Show when={lastAsk()}>
                {(ask) => (
                  <div
                    data-slot="command-card-ask"
                    class="flex min-w-0 flex-col gap-1 rounded-[16px] bg-v2-overlay-simple-overlay-hover px-3.5 py-2.5"
                  >
                    <span class="text-[12px] leading-4 text-v2-text-text-muted">
                      {language.t("secondBrain.commandCentre.strip.you")}
                    </span>
                    <p class="m-0 line-clamp-2 text-[13px] leading-5 text-v2-text-text-base" title={ask()}>
                      {ask()}
                    </p>
                  </div>
                )}
              </Show>
              {/* The reply as the thread shows it (Markdown). Capped at about five lines; Show more lets it
                  grow and scroll inside the card. */}
              <Show
                when={!centre.error() && lastReply()}
                fallback={
                  <p data-slot="command-card-reply" class="m-0 px-1 text-[13px] leading-[21px] text-v2-text-text-muted">
                    {centre.error()
                      ? language.t("common.requestFailed")
                      : language.t("secondBrain.commandCentre.strip.empty")}
                  </p>
                }
              >
                <div class="flex min-w-0 flex-col items-start gap-1">
                  <div
                    ref={reply}
                    data-slot="command-card-reply"
                    data-expanded={state.expanded ? "" : undefined}
                    class="w-full min-w-0 px-1 text-[13px] leading-[21px] text-v2-text-text-base [&_li]:my-0 [&_li>p]:my-0 [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                    classList={{
                      "max-h-[105px] overflow-hidden": !state.expanded,
                      // A cut-off reply fades out, so the last line doesn't look like the end.
                      "[mask-image:linear-gradient(to_bottom,black_65%,transparent)]":
                        state.overflow && !state.expanded,
                      "max-h-64 overflow-y-auto": state.expanded,
                    }}
                  >
                    <Markdown text={lastReply()} class="text-[13px]" />
                  </div>
                  <Show when={state.overflow || state.expanded}>
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      data-action="command-card-reply-more"
                      aria-expanded={state.expanded}
                      onClick={() => setState("expanded", (expanded) => !expanded)}
                    >
                      {language.t(state.expanded ? "ui.sessionTurn.diffs.showLess" : "ui.common.showMore")}
                    </ButtonV2>
                  </Show>
                </div>
              </Show>
              <Show when={waitingHere()}>
                <div class="flex min-w-0 items-center gap-2 rounded-[16px] bg-v2-state-bg-warning px-3 py-1.5">
                  <span class="min-w-0 flex-1 truncate text-[13px] leading-5 text-v2-state-fg-warning">
                    {language.t("secondBrain.commandCentre.strip.waiting")}
                  </span>
                  <ButtonV2 size="small" variant="outline" data-action="command-card-review" onClick={openFull}>
                    {language.t("secondBrain.commandCentre.strip.review")}
                  </ButtonV2>
                </div>
              </Show>
            </div>
          </Show>
          <ComposerBox
            size="compact"
            ref={(element) => (input = element)}
            controller={composer}
            label={language.t("secondBrain.commandCentre.composer.label")}
            placeholder={language.t(
              shown() ? "secondBrain.commandCentre.strip.reply" : "secondBrain.commandCentre.composer.placeholder",
            )}
            sendLabel={language.t("secondBrain.commandCentre.composer.send")}
            controls={
              <Show when={shown()} fallback={<ComposerModelPill harness={harness} />}>
                <span
                  data-slot="command-card-runs-on"
                  title={language.t("secondBrain.commandCentre.strip.runsOn", { name: runsOn() })}
                  class="max-w-56 truncate px-2 type-meta text-v2-text-text-muted"
                >
                  {runsOn()}
                </span>
              </Show>
            }
          />
        </div>
      </div>
    </div>
  )
}
