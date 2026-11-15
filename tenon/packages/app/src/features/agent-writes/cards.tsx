import { useLocation, useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Presence } from "@tenon/ui/v2/presence"
import { Reveal } from "@tenon/ui/v2/reveal"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { AgentWritePreview } from "./preview"
import {
  type AgentWrite,
  type AgentWrites,
  openHref,
  PILL_HIDE_MS,
  pillWrite,
  prefersReducedMotion,
  sessionFromPath,
  useAgentWrites,
} from "./store"

/**
 * Inline cards (W5) for `writes`: inside the turn that made them, or after the last turn for writes
 * without a turn. `centered` puts them in the timeline's centred column when no turn row frames them.
 */
export function AgentWritesInline(props: { writes: ReadonlyArray<AgentWrite>; centered?: boolean }) {
  const writes = useAgentWrites()
  return (
    <Show when={writes && props.writes.length > 0}>
      {/* The same column and padding as the timeline's turns, so a card lines up under the reply that made it. */}
      <div
        data-slot="agent-writes-inline"
        classList={{
          "flex w-full min-w-0 max-w-full flex-col gap-2 px-4 pb-4 md:px-5": true,
          "md:mx-auto md:max-w-[640px]": props.centered,
        }}
      >
        <For each={props.writes}>{(write) => <AgentWriteCard write={write} store={writes!} />}</For>
      </div>
    </Show>
  )
}

/** W5: grows with the preview while the agent writes, then folds to one line with Open, Undo and Show. */
export function AgentWriteCard(props: { write: AgentWrite; store: AgentWrites }) {
  const language = useLanguage()
  const [shown, setShown] = createSignal(false)
  const writing = () => props.write.phase === "started" && !props.write.failed
  const expanded = () => writing() || shown()
  seenWhenSaved(() => props.write, props.store)
  return (
    <section
      data-agent-write
      data-variant="inline"
      data-kind={props.write.kind}
      data-phase={props.write.phase}
      aria-label={language.t(`secondBrain.agentWrites.kind.${props.write.kind}`)}
      class="animate-enter w-full rounded-[12px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
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

/** W4: the top pill for recent writes made by any thread other than the open one. */
export function AgentWritePill() {
  const writes = useAgentWrites()
  const location = useLocation()
  const current = createMemo(() => {
    const store = writes
    if (!store) return undefined
    return pillWrite(store.writes(), sessionFromPath(location.pathname), Date.now())
  })
  // The last pill stays mounted while it animates out.
  const shown = createMemo<AgentWrite | undefined>((previous) => current() ?? previous)
  return (
    <div class="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-4">
      <Presence
        when={!!current()}
        class="flex min-w-0 max-w-full justify-center"
        enterClass="animate-enter"
        exitClass="animate-[v2-motion-exit_var(--v2-duration-exit)_var(--v2-ease-emphasized-accelerate)_forwards] motion-reduce:animate-none"
      >
        <Show when={writes && shown()} keyed>
          {(write) => <Pill write={write} store={writes!} />}
        </Show>
      </Presence>
    </div>
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
    <section
      data-agent-write
      data-variant="pill"
      data-kind={props.write.kind}
      data-phase={props.write.phase}
      role="status"
      aria-label={language.t(`secondBrain.agentWrites.kind.${props.write.kind}`)}
      class="pointer-events-auto w-fit max-w-[min(560px,100%)] rounded-[16px] bg-v2-background-bg-floating shadow-[var(--v2-elevation-floating)]"
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
        {/* Only the open preview sets the pill's width; folded, the pill hugs its one line. */}
        <div class="px-3 pb-3" classList={{ "w-[min(480px,calc(100vw-64px))]": writing() }}>
          <AgentWritePreview kind={props.write.kind} preview={props.write.preview} typing={writing()} />
        </div>
      </Grow>
    </section>
  )
}

/** A write shown inline once it is saved counts as seen, so it never pops a pill later. */
function seenWhenSaved(write: () => AgentWrite, store: AgentWrites) {
  createEffect(() => {
    if (write().phase === "done" && !write().hidden) store.hide(write().id)
  })
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
  // A failed undo keeps Undo so it can be retried; its status shows beside it.
  const undoable = () => ["idle", "pending", "failed"].includes(props.write.undoState)
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
        <Show when={props.write.undoState !== "idle" && props.write.undoState !== "pending"}>
          <span class="px-1 text-[13px] text-v2-text-text-muted" role="status">
            {language.t(
              props.write.undoState === "undone"
                ? "secondBrain.agentWrites.undone"
                : props.write.undoState === "changed"
                  ? "secondBrain.agentWrites.changed"
                  : "secondBrain.agentWrites.undoFailed",
            )}
          </span>
        </Show>
        <Show when={undoable()}>
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
        "bg-v2-icon-icon-accent running-pulse": props.active,
        "bg-v2-icon-icon-muted": !props.active,
      }}
    />
  )
}

/** A `Reveal` that starts closed for one frame, so a card that mounts open still grows. */
function Grow(props: { open: boolean; children: JSX.Element }) {
  const reduced = prefersReducedMotion()
  const [mounted, setMounted] = createSignal(reduced)
  onMount(() => {
    if (reduced) return
    const frame = requestAnimationFrame(() => setMounted(true))
    onCleanup(() => cancelAnimationFrame(frame))
  })
  return <Reveal open={props.open && mounted()}>{props.children}</Reveal>
}
