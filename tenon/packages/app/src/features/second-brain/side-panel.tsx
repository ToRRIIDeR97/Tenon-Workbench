import { Presence } from "@tenon/ui/v2/presence"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import { createComputed, createEffect, createMemo, on, onCleanup, untrack, type JSX, type ParentProps } from "solid-js"
import { replayAnimation } from "@/utils/replay-animation"

/**
 * The Calendar and Tasks layout: the main view and, at lg widths, a 340px side panel column. The column
 * eases open (medium + emphasized-decelerate) and shut (short + emphasized-accelerate) with the panel.
 */
export const sidePanelGridClass = (open: boolean) =>
  open
    ? "grid flex-1 items-start gap-y-3 px-3 pb-3 transition-[grid-template-columns,column-gap] duration-medium ease-emphasized-decelerate motion-reduce:transition-none lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-3"
    : "grid flex-1 items-start gap-y-3 px-3 pb-3 transition-[grid-template-columns,column-gap] duration-short ease-emphasized-accelerate motion-reduce:transition-none lg:grid-cols-[minmax(0,1fr)_0px] lg:gap-x-0"

/**
 * The side panel of `sidePanelGridClass`. It fades in and out with its column, and while closing it shows
 * the content it last rendered (no longer reactive), so it never empties before it has gone. A change of
 * `view` while open (peek to editor, one event to another) fades the new content in. With `onEscape`, Esc
 * closes it from anywhere on the page, unless something else used the key first (a form's own Escape, an
 * open menu or select) or a dialog has focus. Opening moves focus to the panel's heading, and closing returns it
 * to the element that had it before, so keyboard and screen reader users land on what opened.
 */
export function SidePanel(
  props: ParentProps<{
    open: boolean
    view?: string
    ref?: (element: HTMLElement) => void
    onEscape?: () => void
  }>,
) {
  const open = createMemo(() => props.open)
  const panel = {
    aside: undefined as HTMLElement | undefined,
    height: undefined as Animation | undefined,
    from: 0,
  }
  const live = createMemo(() =>
    open()
      ? untrack(() => (
          <aside
            data-component="side-panel"
            ref={(element) => {
              panel.aside = element
              props.ref?.(element)
            }}
            class="flex max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto rounded-[24px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] lg:w-[340px]"
          >
            {props.children}
          </aside>
        ))
      : undefined,
  )
  const shown = createMemo<JSX.Element>((previous) => live() ?? previous)

  createEffect(() => {
    if (!open() || !props.onEscape) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return
      event.preventDefault()
      props.onEscape?.()
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  // The content shown during the exit no longer reacts; keep it from taking clicks or focus meanwhile.
  createEffect(
    on(
      open,
      (value) => {
        if (!value) panel.aside?.setAttribute("inert", "")
      },
      { defer: true },
    ),
  )

  // Focus goes to the heading a frame later, after a menu that opened the panel has restored its own focus.
  const focusHeading = () =>
    requestAnimationFrame(() => {
      const heading = panel.aside?.querySelector<HTMLElement>("h2, h3")
      if (!heading || !open()) return
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1")
      heading.focus({ preventScroll: true })
    })
  // Focus left on the page, or inside the panel, is not someone else's; anywhere else stays where it is.
  const focusIsOurs = () => {
    const active = document.activeElement
    return !active || active === document.body || !!panel.aside?.contains(active)
  }
  let opener: HTMLElement | undefined
  createEffect(
    on(
      open,
      (value) => {
        if (value) {
          opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
          return focusHeading()
        }
        const target = opener
        opener = undefined
        if (target?.isConnected && focusIsOurs()) target.focus({ preventScroll: true })
      },
      { defer: true },
    ),
  )

  // A change of view inside the open panel (peek to peek, peek to editor) is one transition: the new
  // content fades in while the panel's height eases from its old size. The old height is read here, before
  // the content's DOM updates (computations run ahead of render effects).
  const view = () => (open() ? props.view : undefined)
  createComputed(
    on(
      view,
      (next, previous) => {
        panel.from = next !== undefined && previous !== undefined ? (panel.aside?.offsetHeight ?? 0) : 0
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      view,
      (next, previous) => {
        if (next === undefined || previous === undefined) return
        replayAnimation(panel.aside)
        easeHeight()
        if (focusIsOurs()) focusHeading()
      },
      { defer: true },
    ),
  )

  const easeHeight = () => {
    const aside = panel.aside
    panel.height?.cancel()
    panel.height = undefined
    if (!aside || !panel.from || prefersReducedMotion()) return
    const to = aside.offsetHeight
    if (Math.abs(to - panel.from) < 1) return
    // Clipped while it eases, so no scrollbar flashes.
    panel.height = aside.animate(
      [
        { height: `${panel.from}px`, overflow: "hidden" },
        { height: `${to}px`, overflow: "hidden" },
      ],
      {
        duration: motionDuration("medium"),
        easing: getComputedStyle(aside).getPropertyValue("--v2-ease-emphasized-decelerate").trim() || "ease-out",
      },
    )
  }

  return (
    <Presence when={open()} class="min-w-0 overflow-hidden lg:sticky lg:top-3">
      {shown()}
    </Presence>
  )
}

/** Below the two-column layout the panel opens under the main view; bring it into view. */
export function revealSidePanel(element: HTMLElement) {
  queueMicrotask(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) return
    element.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  })
}
