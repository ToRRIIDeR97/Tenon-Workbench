import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { For, Match, Show, Switch, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useCommandCentre } from "@/features/command-centre/command-centre"
import { readVaultPage, writeVaultPage, SecondBrainRequestError } from "@/features/second-brain/client"
import { agentRunStatus, needsYou } from "@/pages/activity-runs"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { sessionHref } from "@/utils/session-route"
import { sessionTitle } from "@/utils/session-title"
import { INBOX_PATH, appendToInbox } from "./inbox"
import {
  initialWidgetMode,
  pickWidgetMode,
  settleWidgetMode,
  widgetEvent,
  type WidgetMode,
  type WidgetModeState,
} from "./widget-mode"

/** How long a finished thread stays under Status. */
const DONE_FOR_MS = 30 * 60_000

/**
 * The desktop widget (docs/design.md, the Widgets workshop): one small card on the desktop showing whatever is
 * newest. A status update (a thread needs you, finishes or fails) turns it to Status, a Command Centre reply turns
 * it to Command, and after a quiet minute it settles on Note, a box that adds a dated entry to the vault's Inbox.
 * It never switches while you type in it; the tabs switch by hand. The window is sized to the card.
 */
export function DesktopWidget() {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const home = createHomeController()
  const sessions = createHomeSessionsController(home)
  const centre = useCommandCentre()
  const mounted = Date.now()
  const [state, setState] = createStore<WidgetModeState>(initialWidgetMode(mounted))
  const [done, setDone] = createStore<{ items: { id: string; title: string; at: number }[] }>({ items: [] })
  let card: HTMLDivElement | undefined

  const apply = (next: WidgetModeState) => setState(next)
  const data = () => home.server.focusedSync().session.data
  // Threads that need you first, then running ones.
  const runs = createMemo(() =>
    sessions.data
      .records()
      .map((record) => ({
        record,
        status: agentRunStatus(data().session_status[record.session.id], needsYou(data(), record.session.id)),
      }))
      .filter((run) => !!run.status)
      .sort((left, right) => Number(right.status === "approval") - Number(left.status === "approval")),
  )
  const waiting = () => runs().filter((run) => run.status === "approval").length

  // Status events: a thread starts needing you, or a running one stops (finished or failed).
  createEffect(
    on(
      () => runs().map((run) => `${run.record.session.id}:${run.status}`),
      (now, before) => {
        if (!before) return
        const previous = new Map(before.map((entry) => entry.split(":") as [string, string]))
        const current = new Map(now.map((entry) => entry.split(":") as [string, string]))
        const asked = [...current].some(([id, status]) => status === "approval" && previous.get(id) !== "approval")
        const stopped = [...previous.keys()].filter((id) => !current.has(id))
        if (stopped.length) {
          const records = sessions.data.records()
          const at = Date.now()
          setDone("items", (items) =>
            [
              ...stopped.map((id) => ({
                id,
                title: sessionTitle(records.find((record) => record.session.id === id)?.session.title) || id,
                at,
              })),
              ...items.filter((item) => !stopped.includes(item.id)),
            ].slice(0, 3),
          )
        }
        if (asked || stopped.length) apply(widgetEvent(state, "status", Date.now()))
      },
    ),
  )

  // A new Command Centre reply turns it to Command. The first seconds are skipped, so the reply that loads with
  // the widget doesn't count as new.
  createEffect(
    on(
      () => centre.lastReply(),
      (reply, before) => {
        if (before === undefined || !reply || reply === before || Date.now() - mounted < 5_000) return
        apply(widgetEvent(state, "reply", Date.now()))
      },
    ),
  )

  // Settles back to Note after a quiet minute; also drops finished threads after half an hour.
  onMount(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      apply(settleWidgetMode(state, now))
      if (done.items.some((item) => now - item.at > DONE_FOR_MS))
        setDone("items", (items) => items.filter((item) => now - item.at <= DONE_FOR_MS))
    }, 5_000)
    onCleanup(() => clearInterval(timer))
  })

  // The window is transparent around the card, so the page behind it must be too.
  onMount(() => {
    const root = document.documentElement
    root.style.background = "transparent"
    document.body.style.background = "transparent"
    onCleanup(() => {
      root.style.background = ""
      document.body.style.background = ""
    })
  })

  // The window follows the card's height.
  onMount(() => {
    if (!card) return
    const observer = new ResizeObserver(() => {
      if (card) void platform.desktopWidget?.resize(card.getBoundingClientRect().height + 24)
    })
    observer.observe(card)
    onCleanup(() => observer.disconnect())
  })

  const open = (path: string) => void platform.desktopWidget?.openInApp(path)
  const tabs: { mode: WidgetMode; label: () => string }[] = [
    { mode: "note", label: () => language.t("secondBrain.widget.note") },
    { mode: "status", label: () => language.t("secondBrain.widget.status") },
    { mode: "command", label: () => language.t("secondBrain.widget.command") },
  ]
  const chip = () =>
    state.mode === "status"
      ? language.t("secondBrain.widget.status")
      : state.mode === "command"
        ? language.t("secondBrain.commandCentre.strip.title")
        : language.t("secondBrain.widget.note")

  return (
    <div class="flex h-dvh w-screen items-start justify-center bg-transparent p-3">
      <section
        ref={card}
        data-component="desktop-widget"
        data-mode={state.mode}
        aria-label={language.t("secondBrain.widget.title")}
        class="flex w-full flex-col overflow-hidden rounded-[22px] bg-v2-background-bg-floating text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
        onPointerEnter={() => setState("engaged", true)}
        onPointerLeave={() => setState("engaged", false)}
        onFocusIn={() => setState("engaged", true)}
        onFocusOut={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setState("engaged", false)
        }}
      >
        {/* The bar drags the window; its buttons don't. */}
        <div class="flex h-10 shrink-0 items-center gap-2 pl-3.5 pr-1.5 [app-region:drag]">
          <span
            class="inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] [font-weight:560]"
            classList={{
              "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container": state.mode !== "note",
              "bg-v2-background-bg-layer-01 text-v2-text-text-muted": state.mode === "note",
            }}
          >
            {chip()}
          </span>
          <span class="flex-1" />
          <span class="flex items-center [app-region:no-drag]">
            <IconButtonV2
              icon={<Icon name="outline-square-arrow" size="small" />}
              size="small"
              variant="ghost-muted"
              aria-label={language.t("secondBrain.widget.openInApp")}
              onClick={() => open(state.mode === "command" ? commandPath() : "/")}
            />
            <IconButtonV2
              icon={<Icon name="xmark-small" size="small" />}
              size="small"
              variant="ghost-muted"
              aria-label={language.t("secondBrain.widget.hide")}
              onClick={() => void platform.desktopWidget?.hide()}
            />
          </span>
        </div>

        <div class="px-3.5 pb-3.5">
          <Switch>
            <Match when={state.mode === "note"}>
              <NoteFace summary={summary()} onTyping={(typing) => setState("typing", typing)} />
            </Match>
            <Match when={state.mode === "status"}>
              <StatusFace runs={runs()} done={done.items} open={(id) => open(sessionHref(server.key, id))} />
            </Match>
            <Match when={state.mode === "command"}>
              <CommandFace open={open} onTyping={(typing) => setState("typing", typing)} />
            </Match>
          </Switch>
        </div>

        <div
          role="tablist"
          aria-label={language.t("secondBrain.widget.title")}
          class="flex gap-1 border-t border-v2-border-border-muted px-2 py-1.5"
        >
          <For each={tabs}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={state.mode === tab.mode}
                class="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] [font-weight:530] outline-none transition-colors duration-short ease-standard focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
                classList={{
                  "bg-v2-background-bg-layer-01 text-v2-text-text-base": state.mode === tab.mode,
                  "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": state.mode !== tab.mode,
                }}
                onClick={() => apply(pickWidgetMode(state, tab.mode, Date.now()))}
              >
                <Show when={tab.mode === "status" && runs().length > 0}>
                  <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" aria-hidden="true" />
                </Show>
                {tab.label()}
                <Show when={tab.mode === "status" && runs().length > 0}>
                  <span class="tabular-nums">{` · ${runs().length}`}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </section>
    </div>
  )

  function commandPath() {
    const id = centre.latest()?.id
    return id ? sessionHref(server.key, id) : "/command"
  }

  function summary() {
    const running = runs().length - waiting()
    if (waiting() > 0) return language.t("secondBrain.widget.summaryWaiting", { waiting: waiting(), running })
    if (running > 0) return language.t("secondBrain.widget.summaryRunning", { running })
    return language.t("secondBrain.widget.summaryQuiet")
  }
}

/** Note: a box whose Enter adds the text to the vault's Inbox as a dated entry; Shift+Enter is a new line. */
function NoteFace(props: { summary: string; onTyping: (typing: boolean) => void }) {
  const language = useLanguage()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const [state, setState] = createStore({ text: "", saving: false, result: "" as "" | "saved" | "failed" })
  let reset: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(reset))

  const save = async () => {
    const text = state.text.trim()
    const directory = layout.home.workspace()
    if (!text || state.saving || !directory) return
    setState({ saving: true, result: "" })
    const client = { server: serverSDK().server, fetch: platform.fetch, target: { directory } }
    const label = language.t("secondBrain.widget.note")
    const ok = await addToInbox(client, text, label)
    setState({ saving: false, result: ok ? "saved" : "failed", text: ok ? "" : state.text })
    clearTimeout(reset)
    reset = setTimeout(() => setState("result", ""), 4_000)
  }

  return (
    <div class="flex flex-col gap-2">
      <label class="flex items-end gap-1.5 rounded-[16px] bg-v2-background-bg-layer-01 py-1.5 pl-3 pr-1.5">
        <textarea
          aria-label={language.t("secondBrain.widget.notePlaceholder")}
          placeholder={language.t("secondBrain.widget.notePlaceholder")}
          rows={2}
          value={state.text}
          class="min-h-10 flex-1 resize-none border-0 bg-transparent py-1 text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
          onInput={(event) => {
            setState("text", event.currentTarget.value)
            props.onTyping(!!event.currentTarget.value)
          }}
          onBlur={(event) => props.onTyping(!!event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
            event.preventDefault()
            void save().then(() => props.onTyping(false))
          }}
        />
        <IconButtonV2
          icon={state.saving ? <LoaderV2 width={14} height={14} /> : <Icon name="check" size="small" />}
          size="small"
          variant="neutral"
          aria-label={language.t("secondBrain.widget.save")}
          disabled={!state.text.trim() || state.saving}
          onClick={() => void save().then(() => props.onTyping(false))}
        />
      </label>
      <span class="flex items-center gap-1.5 px-1 text-[12px] leading-4 text-v2-text-text-muted" role="status">
        <Switch fallback={props.summary}>
          <Match when={state.result === "saved"}>{language.t("secondBrain.widget.saved")}</Match>
          <Match when={state.result === "failed"}>
            <span class="text-v2-text-text-critical">{language.t("secondBrain.widget.saveFailed")}</span>
          </Match>
        </Switch>
      </span>
    </div>
  )
}

/** Adds the note to Inbox.md, creating it when missing; retried when the page changed meanwhile. */
async function addToInbox(client: Parameters<typeof readVaultPage>[0], text: string, label: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readVaultPage(client, INBOX_PATH)
      .catch((error) =>
        error instanceof SecondBrainRequestError && error.status === 404 ? undefined : Promise.reject(error),
      )
      .catch(() => null)
    if (current === null) return false
    const body = appendToInbox(current?.body, text, new Date(), label)
    const written = await writeVaultPage(
      client,
      current
        ? { path: INBOX_PATH, body, expectedRevision: current.revision }
        : { path: INBOX_PATH, body, title: "Inbox", create: true },
    )
      .then(
        () => true,
        (error) => (error instanceof SecondBrainRequestError && error.status === 409 ? false : Promise.reject(error)),
      )
      .catch(() => null)
    if (written === null) return false
    if (written) return true
  }
  return false
}

/** Status: what needs you first, then running threads, then the ones that finished in the last half hour. */
function StatusFace(props: {
  runs: { record: { session: { id: string; title?: string }; projectName: string }; status?: string }[]
  done: { id: string; title: string }[]
  open: (sessionID: string) => void
}) {
  const language = useLanguage()
  const row = "flex min-w-0 items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-[12.5px] leading-5"
  return (
    <div class="flex flex-col gap-1.5">
      <Show
        when={props.runs.length > 0 || props.done.length > 0}
        fallback={
          <p class="m-0 px-1 py-1 text-[12.5px] text-v2-text-text-muted">
            {language.t("secondBrain.widget.nothingRunning")}
          </p>
        }
      >
        <For each={props.runs}>
          {(run) => (
            <Show
              when={run.status === "approval"}
              fallback={
                <button
                  type="button"
                  class={`${row} bg-v2-background-bg-layer-01 text-left hover:bg-v2-overlay-simple-overlay-hover`}
                  onClick={() => props.open(run.record.session.id)}
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1 truncate">
                    {sessionTitle(run.record.session.title) || run.record.session.id}
                  </span>
                  <span class="max-w-24 shrink-0 truncate text-[12px] text-v2-text-text-muted">
                    {run.record.projectName}
                  </span>
                </button>
              }
            >
              <div class={`${row} bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container`}>
                <span class="min-w-0 flex-1 truncate">
                  {sessionTitle(run.record.session.title) || run.record.session.id}
                </span>
                <button
                  type="button"
                  class="h-6 shrink-0 rounded-full bg-v2-background-bg-base px-2.5 text-[12px] [font-weight:530] text-v2-text-text-base"
                  onClick={() => props.open(run.record.session.id)}
                >
                  {language.t("secondBrain.widget.review")}
                </button>
              </div>
            </Show>
          )}
        </For>
        <For each={props.done}>
          {(item) => (
            <button
              type="button"
              class={`${row} bg-v2-background-bg-layer-01 text-left hover:bg-v2-overlay-simple-overlay-hover`}
              onClick={() => props.open(item.id)}
            >
              <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="min-w-0 flex-1 truncate">{item.title}</span>
              <span class="shrink-0 text-[12px] text-v2-text-text-muted">{language.t("secondBrain.widget.done")}</span>
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}

/** Command: the Command Centre's latest exchange and a composer that replies to that thread. */
function CommandFace(props: { open: (path: string) => void; onTyping: (typing: boolean) => void }) {
  const language = useLanguage()
  const centre = useCommandCentre()
  const server = useServer()
  const composer = createComposerController({
    send: async (text) => !!(await centre.send(text, centre.latest()?.id)),
    disabled: () => !centre.directory(),
    blocked: centre.sending,
    persist: "command",
  })
  createEffect(() => props.onTyping(!!composer.value().trim()))
  return (
    <div class="flex flex-col gap-2">
      <Show when={centre.lastAsk()}>
        {(ask) => (
          <div class="flex flex-col gap-0.5 rounded-[14px] bg-v2-background-bg-layer-01 px-3 py-2">
            <span class="text-[12px] leading-4 text-v2-text-text-muted">
              {language.t("secondBrain.commandCentre.strip.you")}
            </span>
            <p class="m-0 line-clamp-2 text-[12.5px] leading-5">{ask()}</p>
          </div>
        )}
      </Show>
      <p
        class="m-0 line-clamp-6 px-1 text-[13px] leading-[20px]"
        classList={{ "text-v2-text-text-muted": !centre.lastReply() }}
      >
        {centre.error()
          ? language.t("common.requestFailed")
          : centre.lastReply() || language.t("secondBrain.commandCentre.strip.empty")}
      </p>
      <Show when={centre.waiting()}>
        <div class="flex min-w-0 items-center gap-2 rounded-[12px] bg-v2-background-bg-accent-container px-2.5 py-1.5 text-[12.5px] text-v2-text-text-on-accent-container">
          <span class="min-w-0 flex-1 truncate">{language.t("secondBrain.commandCentre.strip.waiting")}</span>
          <button
            type="button"
            class="h-6 shrink-0 rounded-full bg-v2-background-bg-base px-2.5 text-[12px] [font-weight:530] text-v2-text-text-base"
            onClick={() => {
              const id = centre.latest()?.id
              props.open(id ? sessionHref(server.key, id) : "/command")
            }}
          >
            {language.t("secondBrain.widget.review")}
          </button>
        </div>
      </Show>
      <ComposerBox
        size="compact"
        controller={composer}
        label={language.t("secondBrain.commandCentre.composer.label")}
        placeholder={language.t("secondBrain.commandCentre.strip.reply")}
        sendLabel={language.t("secondBrain.commandCentre.composer.send")}
      />
    </div>
  )
}
