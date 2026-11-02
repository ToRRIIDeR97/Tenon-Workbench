import {
  type Accessor,
  type JSX,
  type ParentProps,
  Show,
  createComputed,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { motionDuration, prefersReducedMotion } from "./motion"
import "./reveal-v2.css"

export interface RevealProps extends ParentProps {
  open: boolean
  /** `line`: a conditional line (form error, notice, dock label) that opens over swap-in and closes over
   * short + ease-exit, so the content below slides back instead of jumping. `inline`: the same timing, but
   * it widens and narrows for an item in a row (unsaved dot, Discard button). */
  variant?: "line" | "inline"
  class?: string
  onTransitionEnd?: (event: TransitionEvent) => void
  /** Runs when an open or a close has finished, from `transitionend` or the fallback timer (once per phase). */
  onSettled?: (phase: "open" | "closed") => void
}

/**
 * Expands and collapses its children (grid rows 0fr to 1fr, with opacity). Opening uses medium +
 * emphasized-decelerate, closing short + emphasized-accelerate. Children stay mounted while closing and
 * unmount once closed; reduced motion opens and closes at once. The grid and its clip apply only while
 * moving (`data-phase` opening or closing): settled open, the wrapper is a plain block, so it adds no grid
 * layout to every reflow; closed, it is `display: none` and empty.
 */
export function Reveal(props: RevealProps) {
  const reveal = createReveal(
    () => props.open,
    (phase) => props.onSettled?.(phase),
  )

  return (
    <div
      data-component="reveal-v2"
      data-variant={props.variant}
      data-open={props.open ? "" : undefined}
      data-phase={reveal.phase()}
      class={props.class}
      inert={props.open ? undefined : true}
      aria-hidden={props.open ? undefined : "true"}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) reveal.settle()
        props.onTransitionEnd?.(event)
      }}
    >
      <div data-slot="reveal-v2-content">
        <Show when={reveal.mounted()}>{props.children}</Show>
      </div>
    </div>
  )
}

export interface RevealShowProps<T> {
  when: T | undefined | null | false
  class?: string
  children: (value: Accessor<NonNullable<T>>) => JSX.Element
}

/**
 * `Show` for a conditional line that collapses as it leaves (Reveal variant `line`). The children get the
 * last truthy `when`, so a message keeps its text until it has collapsed.
 */
export function RevealShow<T>(props: RevealShowProps<T>) {
  const value = createMemo<NonNullable<T> | undefined>((last) => (props.when ? (props.when as NonNullable<T>) : last))
  return (
    <Reveal open={!!props.when} variant="line" class={props.class}>
      {props.children(value as Accessor<NonNullable<T>>)}
    </Reveal>
  )
}

export type RevealPhase = "closed" | "opening" | "open" | "closing"

/**
 * Reveal's phase machine, separate from the DOM so it can be tested. `settle` ends a running phase; the
 * component calls it on `transitionend`, and a timer calls it when no transition event arrives (hidden
 * element, interrupted style change). `onSettled` hears each finished open or close, including the
 * immediate ones under reduced motion.
 */
export function createReveal(open: Accessor<boolean>, onSettled?: (phase: "open" | "closed") => void) {
  const [phase, setPhase] = createSignal<RevealPhase>(open() ? "open" : "closed")
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  const settle = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    const current = untrack(phase)
    if (current !== "opening" && current !== "closing") return
    const next = current === "opening" ? "open" : "closed"
    setPhase(next)
    onSettled?.(next)
  }

  createComputed(
    on(
      open,
      (next) => {
        clearTimeout(timer.current)
        if (prefersReducedMotion()) {
          setPhase(next ? "open" : "closed")
          onSettled?.(next ? "open" : "closed")
          return
        }
        setPhase(next ? "opening" : "closing")
        timer.current = setTimeout(settle, motionDuration(next ? "medium" : "short") + 50)
      },
      { defer: true },
    ),
  )

  onCleanup(() => clearTimeout(timer.current))

  return {
    phase,
    mounted: () => phase() !== "closed",
    settle,
  }
}
