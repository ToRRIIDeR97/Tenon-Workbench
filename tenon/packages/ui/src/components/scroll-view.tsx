import {
  createEffect,
  createMemo,
  mergeProps,
  onCleanup,
  onMount,
  Show,
  splitProps,
  type Accessor,
  type ComponentProps,
} from "solid-js"
import { Portal } from "solid-js/web"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"
import { prefersReducedMotion } from "../v2/components/motion"

export type ScrollViewThumbVisibility = "hover" | "scroll"

export interface ScrollViewProps extends ComponentProps<"div"> {
  viewportRef?: (el: HTMLDivElement) => void
  orientation?: "vertical" | "horizontal"
  thumbVisibility?: ScrollViewThumbVisibility
  thumbContainer?: HTMLElement | Accessor<HTMLElement | undefined>
  thumbHoverTarget?: HTMLElement | Accessor<HTMLElement | undefined>
}

export const scrollKey = (event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.shiftKey && event.key !== " ") return

  switch (event.key) {
    case "PageDown":
      return "page-down"
    case "PageUp":
      return "page-up"
    case "Home":
      return "home"
    case "End":
      return "end"
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
    case " ":
      return event.shiftKey ? "page-up" : "page-down"
  }
}

export function canScrollKey(element: HTMLElement, key: NonNullable<ReturnType<typeof scrollKey>>) {
  const up = key === "up" || key === "page-up" || key === "home"
  return up ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight
}

export function scrollKeyOwner(
  root: HTMLElement,
  target: EventTarget | null,
  key: NonNullable<ReturnType<typeof scrollKey>>,
) {
  const element = target instanceof Element ? target : undefined
  const owner = element?.closest<HTMLElement>("[data-scrollable]")
  if (!owner || owner === root) return root
  if (!root.contains(owner)) return owner
  return canScrollKey(owner, key) ? owner : root
}

export function isScrollKeyTarget(target: EventTarget | null, key: NonNullable<ReturnType<typeof scrollKey>>) {
  const element = target instanceof HTMLElement ? target : undefined
  if (!element) return true
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.isContentEditable) return false
  if ((key === "page-up" || key === "page-down") && element.closest('button, a[href], [role="button"]')) return false
  return true
}

export function scrollTopFromThumbPointer(input: {
  pointer: number
  viewportTop: number
  grabOffset: number
  clientHeight: number
  scrollHeight: number
  thumbHeight: number
  scrollClientHeight?: number
}) {
  const padding = 8
  const maxThumbTop = input.clientHeight - padding * 2 - input.thumbHeight
  if (maxThumbTop <= 0) return 0
  const thumbTop = Math.max(0, Math.min(input.pointer - input.viewportTop - padding - input.grabOffset, maxThumbTop))
  return (thumbTop / maxThumbTop) * Math.max(0, input.scrollHeight - (input.scrollClientHeight ?? input.clientHeight))
}

export function ScrollView(props: ScrollViewProps) {
  const i18n = useI18n()
  const merged = mergeProps({ orientation: "vertical", thumbVisibility: "hover" }, props)
  const [local, events, rest] = splitProps(
    merged,
    [
      "class",
      "children",
      "viewportRef",
      "orientation",
      "thumbVisibility",
      "thumbContainer",
      "thumbHoverTarget",
      "style",
    ],
    [
      "onScroll",
      "onWheel",
      "onTouchStart",
      "onTouchMove",
      "onTouchEnd",
      "onTouchCancel",
      "onPointerDown",
      "onClick",
      "onKeyDown",
    ],
  )

  let rootRef!: HTMLDivElement
  let viewportRef!: HTMLDivElement
  let thumbRef!: HTMLDivElement

  const resolveEl = (value: HTMLElement | Accessor<HTMLElement | undefined> | undefined) => {
    if (typeof value === "function") return value()
    return value
  }

  const thumbMount = createMemo(() => resolveEl(local.thumbContainer))
  const thumbHover = createMemo(() => resolveEl(local.thumbHoverTarget))
  const hoverRoot = () => !local.thumbHoverTarget && !local.thumbContainer

  const [state, setState] = createStore({
    isHovered: false,
    isDragging: false,
    isScrolling: false,
    thumbHeight: 0,
    thumbTop: 0,
    showThumb: false,
  })
  const isHovered = () => state.isHovered
  const isDragging = () => state.isDragging
  const isScrolling = () => state.isScrolling
  const thumbHeight = () => state.thumbHeight
  const thumbTop = () => state.thumbTop
  const showThumb = () => state.showThumb

  let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined

  const markScrolling = () => {
    setState("isScrolling", true)
    if (scrollIdleTimer !== undefined) clearTimeout(scrollIdleTimer)
    scrollIdleTimer = setTimeout(() => setState("isScrolling", false), 800)
  }

  const thumbVisible = () => {
    if (isDragging()) return true
    if (isScrolling()) return true
    return local.thumbVisibility === "hover" && isHovered()
  }

  onCleanup(() => {
    if (scrollIdleTimer !== undefined) clearTimeout(scrollIdleTimer)
  })

  const updateThumb = () => {
    if (!viewportRef) return
    const { scrollTop, scrollHeight, clientHeight } = viewportRef

    if (scrollHeight <= clientHeight || scrollHeight === 0) {
      setState("showThumb", false)
      return
    }

    setState("showThumb", true)
    const trackPadding = 8
    const trackClientHeight = thumbMount()?.clientHeight || clientHeight
    const trackHeight = trackClientHeight - trackPadding * 2

    const minThumbHeight = 32
    let height = (clientHeight / scrollHeight) * trackHeight
    height = Math.max(height, minThumbHeight)

    const maxScrollTop = scrollHeight - clientHeight
    const maxThumbTop = trackHeight - height

    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0

    const boundedTop = trackPadding + Math.max(0, Math.min(top, maxThumbTop))

    setState("thumbHeight", height)
    setState("thumbTop", boundedTop)
  }

  onMount(() => {
    if (local.viewportRef) {
      local.viewportRef(viewportRef)
    }

    createResizeObserver(
      () => [viewportRef, viewportRef.firstElementChild, thumbMount()].filter(Boolean) as HTMLElement[],
      updateThumb,
    )

    updateThumb()
  })

  createEffect(() => {
    thumbMount()
    updateThumb()
  })

  createEffect(() => {
    const target = thumbHover()
    if (!target) return

    const enter = () => setState("isHovered", true)
    const leave = () => setState("isHovered", false)
    target.addEventListener("pointerenter", enter)
    target.addEventListener("pointerleave", leave)
    onCleanup(() => {
      target.removeEventListener("pointerenter", enter)
      target.removeEventListener("pointerleave", leave)
      setState("isHovered", false)
    })
  })

  const onThumbPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState("isDragging", true)
    const grabOffset = e.clientY - thumbRef.getBoundingClientRect().top
    const track = thumbMount() ?? viewportRef

    thumbRef.setPointerCapture(e.pointerId)

    const onPointerMove = (e: PointerEvent) => {
      const { scrollHeight, clientHeight } = viewportRef
      viewportRef.scrollTop = scrollTopFromThumbPointer({
        pointer: e.clientY,
        viewportTop: track.getBoundingClientRect().top,
        grabOffset,
        clientHeight: track.clientHeight,
        scrollClientHeight: clientHeight,
        scrollHeight,
        thumbHeight: thumbHeight(),
      })
    }

    const done = (e: PointerEvent) => {
      setState("isDragging", false)
      thumbRef.releasePointerCapture(e.pointerId)
      thumbRef.removeEventListener("pointermove", onPointerMove)
      thumbRef.removeEventListener("pointerup", done)
      thumbRef.removeEventListener("pointercancel", done)
    }

    thumbRef.addEventListener("pointermove", onPointerMove)
    thumbRef.addEventListener("pointerup", done)
    thumbRef.addEventListener("pointercancel", done)
  }

  const renderThumb = () => (
    <div
      ref={(el) => {
        thumbRef = el
      }}
      onPointerDown={onThumbPointerDown}
      class="scroll-view__thumb"
      data-visible={thumbVisible()}
      data-dragging={isDragging()}
      style={{
        height: `${thumbHeight()}px`,
        transform: `translateY(${thumbTop()}px)`,
        "z-index": 100,
      }}
    />
  )

  const onKeyDown = (e: KeyboardEvent) => {
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      return
    }
    const next = scrollKey(e)
    if (!next) return
    if (!isScrollKeyTarget(e.target, next)) return
    if (scrollKeyOwner(viewportRef, e.target, next) !== viewportRef) return

    const scrollAmount = viewportRef.clientHeight * 0.8
    const lineAmount = 40
    const behavior = prefersReducedMotion() ? "auto" : "smooth"

    switch (next) {
      case "page-down":
        e.preventDefault()
        viewportRef.scrollBy({ top: scrollAmount, behavior })
        break
      case "page-up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -scrollAmount, behavior })
        break
      case "home":
        e.preventDefault()
        viewportRef.scrollTo({ top: 0, behavior })
        break
      case "end":
        e.preventDefault()
        viewportRef.scrollTo({ top: viewportRef.scrollHeight, behavior })
        break
      case "up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -lineAmount, behavior })
        break
      case "down":
        e.preventDefault()
        viewportRef.scrollBy({ top: lineAmount, behavior })
        break
    }
  }

  return (
    <div
      ref={rootRef}
      class={`scroll-view ${local.class || ""}`}
      style={local.style}
      onPointerEnter={() => {
        if (hoverRoot()) setState("isHovered", true)
      }}
      onPointerLeave={() => {
        if (hoverRoot()) setState("isHovered", false)
      }}
      {...rest}
    >
      <div
        ref={viewportRef}
        class="scroll-view__viewport"
        data-scrollable
        onScroll={(e) => {
          updateThumb()
          markScrolling()
          if (typeof events.onScroll === "function") events.onScroll(e as any)
        }}
        onWheel={(e) => {
          markScrolling()
          const handler = events.onWheel
          if (typeof handler === "function") handler(e as any)
          if (Array.isArray(handler)) handler[0](handler[1], e as any)
        }}
        onTouchStart={events.onTouchStart as any}
        onTouchMove={events.onTouchMove as any}
        onTouchEnd={events.onTouchEnd as any}
        onTouchCancel={events.onTouchCancel as any}
        onPointerDown={events.onPointerDown as any}
        onClick={events.onClick as any}
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
        onKeyDown={(e) => {
          onKeyDown(e)
          if (typeof events.onKeyDown === "function") events.onKeyDown(e as any)
        }}
      >
        {local.children}
      </div>

      <Show when={showThumb()}>
        <Show when={thumbMount()} fallback={renderThumb()}>
          {(mount) => <Portal mount={mount()}>{renderThumb()}</Portal>}
        </Show>
      </Show>
    </div>
  )
}
