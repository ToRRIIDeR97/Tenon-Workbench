import { useLocation, useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { AgentWritePreview } from "./preview"
import {
  type AgentWrite,
  type AgentWrites,
  openHref,
  prefersReducedMotion,
  sessionFromPath,
  useAgentWrites,
} from "./store"

const PILL_HIDE_MS = 6_000

/** The writes `sessionID` made, as inline cards at the end of its thread (W5). */
export function AgentWritesInline(props: { sessionID: string }) {
  const writes = useAgentWrites()
  return (
    <Show when={writes}>
      {(store) => (
        <div data-slot="agent-writes-inline" class="flex w-full flex-col gap-2 px-4 md:px-5 pb-4">
          <For each={store().forSession(props.sessionID)}>
            {(write) => <AgentWriteCard write={write} store={store()} />}
          </For>
        </div>
      )}
    </Show>
  )
}

/** W5: grows with the preview while the agent writes, then folds to one line with Open, Undo and Show. */
export function AgentWriteCard(props: { write: AgentWrite; store: AgentWrites }) {
  const language = useLanguage()
  const [shown, setShown] = createSignal(false)
  const writing = () => props.write.phase === "started" && !props.write.failed
  const expanded = () => writing() || shown()
  return (
    <section
      data-agent-write
      data-variant="inline"
      data-kind={props.write.kind}
      data-phase={props.write.phase}
      aria-label={language.t(`secondBrain.agentWrites.kind.${props.write.kind}`)}
      class="w-full max-w-[720px] rounded-[12px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
    >
      <div class="flex min-h-10 items-center gap-2 px-3 py-1.5">
        <StatusDot active={writing()} />
        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">
          <Headline write={props.write} />
        </span>
        <Show when={!writing()}>
          <Actions write={props.write} store={props.store}>
            <ButtonV2 size="small" variant="ghost" aria-expanded={shown()} onClick={() => setShown((value) => !value)}>
              {language.t(shown() ? "secondBrain.agentWrites.hide" : "secondBrain.agentWrites.show")}
            </ButtonV2>
          </Actions>
        </Show>
      </div>
      <Grow open={expanded()}>
        <div class="px-3 pb-3">
          <AgentWritePreview kind={props.write.kind} preview={props.write.preview} typing={writing()} />
        </div>
      </Grow>
    </section>
  )
}

/** W4: the top pill for writes made by any thread other than the open one. */
export function AgentWritePill() {
  const writes = useAgentWrites()
  const location = useLocation()
  const current = createMemo(() => {
    const store = writes
    if (!store) return undefined
    const open = sessionFromPath(location.pathname) ?? store.focused()
    return store
      .writes()
      .filter((write) => !write.hidden && write.sessionID !== open)
      .at(-1)
  })
  return (
    <Show when={writes && current()} keyed>
      {(write) => <Pill write={write} store={writes!} />}
    </Show>
  )
}

function Pill(props: { write: AgentWrite; store: AgentWrites }) {
  const language = useLanguage()
  const [held, setHeld] = createSignal(false)
  const writing = () => props.write.phase === "started" && !props.write.failed
  createEffect(() => {
    if (writing() || held() || props.write.undoState === "pending") return
    const timer = setTimeout(() => props.store.hide(props.write.id), PILL_HIDE_MS)
    onCleanup(() => clearTimeout(timer))
  })
  return (
    <div class="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-4">
      <section
        data-agent-write
        data-variant="pill"
        data-kind={props.write.kind}
        data-phase={props.write.phase}
        role="status"
        aria-label={language.t(`secondBrain.agentWrites.kind.${props.write.kind}`)}
        class="pointer-events-auto w-fit max-w-[min(560px,100%)] rounded-[20px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 shadow-[0_4px_16px_rgb(0_0_0/0.12)]"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocusIn={() => setHeld(true)}
        onFocusOut={() => setHeld(false)}
      >
        <div class="flex min-h-9 items-center gap-2 px-3 py-1">
          <StatusDot active={writing()} />
          <span class="min-w-0 truncate text-[13px] text-v2-text-text-base">
            <Show when={writing() || props.write.failed} fallback={language.t("secondBrain.agentWrites.saved")}>
              <Headline write={props.write} />
            </Show>
          </span>
          <Show when={!writing() && props.write.target}>
            <span class="min-w-0 truncate text-[13px] text-v2-text-text-muted">{props.write.target}</span>
          </Show>
          <Show when={!writing()}>
            <Actions write={props.write} store={props.store} />
          </Show>
        </div>
        <Grow open={writing()}>
          <div class="w-[min(480px,calc(100vw-64px))] px-3 pb-3">
            <AgentWritePreview kind={props.write.kind} preview={props.write.preview} typing={writing()} />
          </div>
        </Grow>
      </section>
    </div>
  )
}

/**
 * The writes of one turn as a step list (`data-variant="steps"`): a row per write and the active
 * (latest) row's preview. Mounted by the Command Centre page.
 */
export function AgentWriteSteps(props: { writes: ReadonlyArray<AgentWrite>; store?: AgentWrites }) {
  const language = useLanguage()
  const store = props.store ?? useAgentWrites()
  const active = () => props.writes.at(-1)
  return (
    <section
      data-agent-write
      data-variant="steps"
      aria-label={language.t("secondBrain.agentWrites.steps")}
      class="w-full rounded-[12px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
    >
      <ol class="flex flex-col">
        <For each={props.writes}>
          {(write) => (
            <li data-agent-write-step data-kind={write.kind} data-phase={write.phase} class="flex flex-col">
              <div class="flex min-h-9 items-center gap-2 px-3 py-1">
                <StatusDot active={write.phase === "started" && !write.failed} />
                <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">
                  <Headline write={write} />
                </span>
                <Show when={store && write.phase === "done"}>
                  <Actions write={write} store={store!} />
                </Show>
              </div>
              <Show when={active()?.id === write.id}>
                <div class="px-3 pb-3">
                  <AgentWritePreview
                    kind={write.kind}
                    preview={write.preview}
                    typing={write.phase === "started" && !write.failed}
                  />
                </div>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}

function Headline(props: { write: AgentWrite }) {
  const language = useLanguage()
  const kind = () => language.t(`secondBrain.agentWrites.kind.${props.write.kind}`)
  const target = () => props.write.target
  return (
    <>
      {props.write.failed
        ? language.t("secondBrain.agentWrites.failed", { kind: kind() })
        : props.write.phase === "started"
          ? language.t("secondBrain.agentWrites.writing", { kind: kind(), target: target() })
          : language.t("secondBrain.agentWrites.savedTo", { kind: kind(), target: target() })}
    </>
  )
}

function Actions(props: { write: AgentWrite; store: AgentWrites; children?: JSX.Element }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const href = () => openHref(props.write)
  return (
    <div class="flex shrink-0 items-center gap-1">
      <Show when={href()}>
        {(target) => (
          <ButtonV2 size="small" variant="ghost" onClick={() => navigate(target())}>
            {language.t("secondBrain.agentWrites.open")}
          </ButtonV2>
        )}
      </Show>
      <Show when={props.write.undo && !props.write.failed}>
        <Show
          when={props.write.undoState === "idle" || props.write.undoState === "pending"}
          fallback={
            <span class="px-1 text-[13px] text-v2-text-text-muted" role="status">
              {language.t(
                props.write.undoState === "undone"
                  ? "secondBrain.agentWrites.undone"
                  : props.write.undoState === "changed"
                    ? "secondBrain.agentWrites.changed"
                    : "secondBrain.agentWrites.undoFailed",
              )}
            </span>
          }
        >
          <ButtonV2
            size="small"
            variant="ghost"
            disabled={props.write.undoState === "pending"}
            onClick={() => void props.store.undo(props.write.id)}
          >
            {language.t("secondBrain.agentWrites.undo")}
          </ButtonV2>
        </Show>
      </Show>
      {props.children}
    </div>
  )
}

/** Accent only while a write is active; neutral once it is saved. */
function StatusDot(props: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-slot="agent-write-dot"
      class="size-2 shrink-0 rounded-full"
      classList={{
        "bg-v2-icon-icon-accent animate-pulse motion-reduce:animate-none": props.active,
        "bg-v2-icon-icon-muted": !props.active,
      }}
    />
  )
}

/**
 * Height growth over 400 ms with emphasized-decelerate (grid rows 0fr → 1fr). It starts closed for one
 * frame so a card that mounts open still grows; with reduced motion it opens at once.
 */
function Grow(props: { open: boolean; children: JSX.Element }) {
  const reduced = prefersReducedMotion()
  const [mounted, setMounted] = createSignal(reduced)
  onMount(() => {
    if (reduced) return
    const frame = requestAnimationFrame(() => setMounted(true))
    onCleanup(() => cancelAnimationFrame(frame))
  })
  return (
    <div
      data-slot="agent-write-grow"
      data-open={props.open}
      class="grid transition-[grid-template-rows] duration-[400ms] ease-[var(--v2-ease-emphasized-decelerate)] motion-reduce:transition-none"
      style={{ "grid-template-rows": props.open && mounted() ? "1fr" : "0fr" }}
      aria-hidden={!props.open}
    >
      <div class="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  )
}
