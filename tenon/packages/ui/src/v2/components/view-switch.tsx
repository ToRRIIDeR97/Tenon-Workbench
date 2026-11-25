import {
  type Accessor,
  type JSX,
  type ParentProps,
  children,
  createComputed,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { motionDuration, prefersReducedMotion } from "./motion"
import "./view-switch-v2.css"

export interface ViewSwitchProps extends ParentProps {
  key: string | number | undefined
  exit?: boolean
  class?: string
}

export function ViewSwitch(props: ViewSwitchProps) {
  const resolved = children(() => props.children)
  const view = createViewSwitch(
    () => props.key,
    () => resolved.toArray(),
    () => props.exit !== false,
  )
  const [ref, setRef] = createSignal<HTMLDivElement>()
  const focus = { restore: false }

  createComputed(
    on(view.phase, (phase) => {
      if (phase !== "out") return
      focus.restore = !!ref()?.contains(document.activeElement)
    }),
  )

  createEffect(
    on(view.phase, (phase) => {
      if (phase === "out" || !focus.restore) return
      focus.restore = false
      const element = ref()
      const active = document.activeElement
      if (!element || element.contains(active) || (active && active !== document.body)) return
      const target = element.querySelector<HTMLElement>("[autofocus]") ?? element.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus({ preventScroll: true })
    }),
  )

  return (
    <div
      ref={setRef}
      data-component="view-switch-v2"
      data-phase={view.phase()}
      inert={view.phase() === "out" ? true : undefined}
      aria-hidden={view.phase() === "out" ? "true" : undefined}
      class={props.class}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) view.advance()
      }}
    >
      {view.nodes()}
    </div>
  )
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type ViewSwitchPhase = "idle" | "out" | "in"

export function createViewSwitch<K>(
  key: Accessor<K>,
  nodes: Accessor<JSX.Element[]>,
  exit: Accessor<boolean> = () => true,
) {
  const [phase, setPhase] = createSignal<ViewSwitchPhase>("idle")
  const [frozen, setFrozen] = createSignal<JSX.Element[]>()
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const last = { key: untrack(key), nodes: untrack(nodes) }

  const schedule = (ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(advance, ms + 50)
  }

  const advance = () => {
    const current = untrack(phase)
    if (current === "out") {
      setFrozen(undefined)
      setPhase("in")
      schedule(motionDuration("medium"))
      return
    }
    clearTimeout(timer.current)
    timer.current = undefined
    setFrozen(undefined)
    setPhase("idle")
  }

  createComputed(() => {
    const next = { key: key(), nodes: nodes() }
    const previous = { ...last }
    last.key = next.key
    last.nodes = next.nodes
    if (next.key === previous.key) return
    untrack(() => {
      if (prefersReducedMotion()) {
        clearTimeout(timer.current)
        timer.current = undefined
        setFrozen(undefined)
        setPhase("idle")
        return
      }
      if (phase() === "out") return
      if (!exit()) {
        setFrozen(undefined)
        setPhase("in")
        schedule(motionDuration("medium"))
        return
      }
      setFrozen(() => previous.nodes)
      setPhase("out")
      schedule(motionDuration("short"))
    })
  })

  onCleanup(() => clearTimeout(timer.current))

  return {
    phase,
    nodes: () => (phase() === "out" ? frozen() : undefined) ?? nodes(),
    advance,
  }
}
