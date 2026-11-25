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
  variant?: "line" | "inline" | "even"
  class?: string
  onTransitionEnd?: (event: TransitionEvent) => void
  onSettled?: (phase: "open" | "closed") => void
}

export function Reveal(props: RevealProps) {
  const reveal = createReveal(
    () => props.open,
    (phase) => props.onSettled?.(phase),
    props.variant === "even" ? "medium" : "short",
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

export function RevealShow<T>(props: RevealShowProps<T>) {
  const value = createMemo<NonNullable<T> | undefined>((last) => (props.when ? (props.when as NonNullable<T>) : last))
  return (
    <Reveal open={!!props.when} variant="line" class={props.class}>
      {props.children(value as Accessor<NonNullable<T>>)}
    </Reveal>
  )
}

export type RevealPhase = "closed" | "opening" | "open" | "closing"

export function createReveal(
  open: Accessor<boolean>,
  onSettled?: (phase: "open" | "closed") => void,
  closing: "short" | "medium" = "short",
) {
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
        timer.current = setTimeout(settle, motionDuration(next ? "medium" : closing) + 50)
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
