import { For, Show, createEffect, createMemo, on, onCleanup, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { designTooLarge, type CanvasDesign } from "@tenon/session-ui/design-fence"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import {
  ARTBOARD,
  blendCamera,
  boardCamera,
  boardColumns,
  boardLayout,
  cssEasing,
  zoomAt,
  type Camera,
} from "@/pages/session/board-camera"
import { DesignFrame, LiveDesignFrame } from "@/pages/session/live-design-frame"

// A press that moves less than this is a click on a board, not a pan.
const DRAG_THRESHOLD = 4
const ZOOM_STEP = 1.25
const KEY_PAN = 48
// The gap between a label's parts (gap-2).
const LABEL_GAP = 8

const sameCamera = (a: Camera, b: Camera) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.scale - b.scale) < 0.0005

/**
 * The Canvas tab's designs as artboards on a pan/zoom board. The world layer is one transformed element
 * (frames are never rebuilt when the camera moves); labels sit in screen space above each board. While a
 * design streams the camera follows its board, otherwise it shows them all; panning or zooming stops the
 * following until the next design starts.
 */
export function DesignBoard(props: {
  keys: string[]
  design: (key: string) => CanvasDesign | undefined
  title: (design: CanvasDesign) => string
  onOpen: (key: string) => void
  onUse: (design: CanvasDesign) => void
}) {
  const language = useLanguage()
  const [view, setView] = createStore({
    camera: { x: 0, y: 0, scale: 1 },
    size: { width: 0, height: 0 },
    follow: true,
    placed: false,
    moving: false,
  })
  // The column count that shows the boards largest in this viewport; a resize may change it.
  const columns = createMemo(() => boardColumns(props.keys.length, view.size))
  const layout = createMemo(() => boardLayout(props.keys.length, { columns: columns() }))
  const drawingKey = createMemo(() => props.keys.findLast((key) => props.design(key)?.streaming))
  const drawing = createMemo(() => {
    const key = drawingKey()
    return key === undefined ? undefined : props.keys.indexOf(key)
  })
  const target = createMemo(
    () => boardCamera({ layout: layout(), drawing: drawing(), viewport: view.size }),
    { x: 0, y: 0, scale: 1 },
    { equals: sameCamera },
  )
  const motion = { frame: 0 }
  let viewport!: HTMLDivElement

  const stop = () => {
    cancelAnimationFrame(motion.frame)
    setView("moving", false)
  }
  const place = (camera: Camera) => {
    stop()
    setView("camera", camera)
  }
  // Camera moves the app makes glide with the long duration and emphasized-decelerate easing.
  const glide = (camera: Camera) => {
    if (!view.placed || prefersReducedMotion()) {
      setView("placed", true)
      place(camera)
      return
    }
    stop()
    const from = { ...view.camera }
    const start = performance.now()
    const duration = motionDuration("long")
    const ease = cssEasing(
      getComputedStyle(document.documentElement).getPropertyValue("--v2-ease-emphasized-decelerate"),
    )
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      setView("camera", blendCamera(from, camera, ease(progress)))
      if (progress < 1) {
        motion.frame = requestAnimationFrame(step)
        return
      }
      setView("moving", false)
    }
    setView("moving", true)
    motion.frame = requestAnimationFrame(step)
  }
  // The user moved the camera: it stays where they put it until the next design starts drawing.
  const steer = (camera: Camera) => {
    setView("follow", false)
    setView("placed", true)
    place(camera)
  }
  const centre = () => ({ x: view.size.width / 2, y: view.size.height / 2 })
  const zoom = (factor: number) => steer(zoomAt(view.camera, factor, centre()))
  const fitAll = () => {
    setView("follow", false)
    glide(boardCamera({ layout: layout(), viewport: view.size }))
  }

  createEffect(
    on(
      drawingKey,
      (key, previous) => {
        if (key !== undefined && key !== previous) setView("follow", true)
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    const camera = target()
    if (!view.follow || view.size.width === 0) return
    untrack(() => glide(camera))
  })

  const press = { id: -1, x: 0, y: 0, moved: false, dragged: false }
  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setView("size", { width: rect.width, height: rect.height })
    })
    observer.observe(viewport)
    // Wheel and trackpad pinch (which arrives as a wheel with ctrlKey) zoom at the pointer.
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = viewport.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015))
      steer(zoomAt(view.camera, factor, { x: event.clientX - box.left, y: event.clientY - box.top }))
    }
    viewport.addEventListener("wheel", wheel, { passive: false })
    // A drag that ends over a board doesn't open it: the click is stopped before it reaches the board.
    const click = (event: MouseEvent) => {
      if (!press.dragged) return
      press.dragged = false
      event.stopPropagation()
      event.preventDefault()
    }
    viewport.addEventListener("click", click, true)
    // On the element itself, so the board's keys run before the app's document-level shortcuts.
    const key = (event: KeyboardEvent) => {
      if (event.target !== viewport) return
      const actions: Record<string, () => void> = {
        "+": () => zoom(ZOOM_STEP),
        "=": () => zoom(ZOOM_STEP),
        "-": () => zoom(1 / ZOOM_STEP),
        _: () => zoom(1 / ZOOM_STEP),
        "0": fitAll,
        ArrowLeft: () => steer({ ...view.camera, x: view.camera.x + KEY_PAN }),
        ArrowRight: () => steer({ ...view.camera, x: view.camera.x - KEY_PAN }),
        ArrowUp: () => steer({ ...view.camera, y: view.camera.y + KEY_PAN }),
        ArrowDown: () => steer({ ...view.camera, y: view.camera.y - KEY_PAN }),
      }
      const action = actions[event.key]
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    viewport.addEventListener("keydown", key)
    onCleanup(() => {
      observer.disconnect()
      viewport.removeEventListener("wheel", wheel)
      viewport.removeEventListener("click", click, true)
      viewport.removeEventListener("keydown", key)
      stop()
    })
  })

  const letter = (index: number) => (index < 26 ? String.fromCharCode(65 + index) : String(index + 1))
  const screen = (index: number) => {
    const rect = layout()[index]
    if (!rect) return { x: 0, y: 0, width: 0 }
    return {
      x: rect.x * view.camera.scale + view.camera.x,
      y: rect.y * view.camera.scale + view.camera.y,
      width: rect.width * view.camera.scale,
    }
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center justify-end px-3 pb-2">
        <div class="flex items-center gap-0.5 rounded-full bg-v2-background-bg-layer-01 p-0.5 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
          <TooltipV2 placement="bottom" value={language.t("secondBrain.canvas.zoomOut")}>
            <IconButtonV2
              icon={<span aria-hidden="true">−</span>}
              size="small"
              variant="ghost-muted"
              aria-label={language.t("secondBrain.canvas.zoomOut")}
              onClick={() => zoom(1 / ZOOM_STEP)}
            />
          </TooltipV2>
          <TooltipV2 placement="bottom" value={language.t("secondBrain.canvas.fitAll")}>
            <button
              type="button"
              data-slot="board-zoom"
              class="h-7 min-w-12 rounded-full px-2 type-control tabular-nums text-v2-text-text-base outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
              aria-label={language.t("secondBrain.canvas.fitAllZoom", {
                percent: Math.round(view.camera.scale * 100),
              })}
              onClick={fitAll}
            >
              {`${Math.round(view.camera.scale * 100)}%`}
            </button>
          </TooltipV2>
          <TooltipV2 placement="bottom" value={language.t("secondBrain.canvas.zoomIn")}>
            <IconButtonV2
              icon={<span aria-hidden="true">+</span>}
              size="small"
              variant="ghost-muted"
              aria-label={language.t("secondBrain.canvas.zoomIn")}
              onClick={() => zoom(ZOOM_STEP)}
            />
          </TooltipV2>
        </div>
      </div>
      <div class="min-h-0 flex-1 px-3 pb-3">
        <div
          ref={viewport}
          data-slot="design-board"
          data-following={view.follow ? "" : undefined}
          data-camera-moving={view.moving ? "" : undefined}
          role="region"
          aria-label={language.t("secondBrain.canvas.board")}
          tabIndex={0}
          class="relative size-full touch-none select-none overflow-hidden rounded-[12px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
          style={{
            "background-image": "radial-gradient(var(--v2-border-border-muted) 1px, transparent 1.5px)",
            "background-size": "20px 20px",
            "background-position": `${view.camera.x}px ${view.camera.y}px`,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            Object.assign(press, { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false })
          }}
          onPointerMove={(event) => {
            if (event.pointerId !== press.id) return
            const dx = event.clientX - press.x
            const dy = event.clientY - press.y
            if (!press.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
            if (!press.moved) viewport.setPointerCapture(event.pointerId)
            press.moved = true
            press.x = event.clientX
            press.y = event.clientY
            steer({ ...view.camera, x: view.camera.x + dx, y: view.camera.y + dy })
          }}
          onPointerUp={(event) => {
            if (event.pointerId !== press.id) return
            press.dragged = press.moved
            press.id = -1
            if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            press.id = -1
          }}
        >
          <div
            data-slot="design-board-world"
            class="absolute left-0 top-0 origin-top-left"
            style={{
              transform: `translate(${view.camera.x}px, ${view.camera.y}px) scale(${view.camera.scale})`,
              "--board-scale": String(view.camera.scale),
            }}
          >
            <For each={props.keys}>
              {(key, index) => (
                <Show when={props.design(key)}>
                  {(design) => (
                    <BoardArtboard
                      design={design()}
                      title={props.title(design())}
                      rect={layout()[index()] ?? { x: 0, y: 0, ...ARTBOARD }}
                      label={language.t("secondBrain.canvas.view", { title: props.title(design()) })}
                      onOpen={() => props.onOpen(key)}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
          {/* Labels stay at screen size: placed from the camera, not scaled with the world. */}
          <div class="pointer-events-none absolute inset-0">
            <For each={props.keys}>
              {(key, index) => (
                <Show when={props.design(key)}>
                  {(design) => (
                    <BoardLabel
                      boardKey={key}
                      title={language.t("secondBrain.canvas.boardTitle", {
                        letter: letter(index()),
                        title: props.title(design()),
                      })}
                      streaming={!!design().streaming}
                      x={screen(index()).x}
                      y={screen(index()).y}
                      width={screen(index()).width}
                      onUse={() => props.onUse(design())}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One artboard in world space. A design streaming when its board appears draws live; frames are built once. */
function BoardArtboard(props: {
  design: CanvasDesign
  title: string
  rect: { x: number; y: number; width: number; height: number }
  label: string
  onOpen: () => void
}) {
  const live = untrack(() => !!props.design.streaming)
  // Over the size cap the finished-frame path shows the notice.
  const large = createMemo(() => designTooLarge(props.design.source))
  return (
    // Fixed white: a design is a standalone page that assumes a white canvas.
    <button
      type="button"
      data-board-drawing={props.design.streaming ? "" : undefined}
      aria-label={props.label}
      class="absolute block overflow-hidden bg-[#fff] p-0 outline-none [border-radius:calc(8px/var(--board-scale))] shadow-[0_0_0_calc(1px/var(--board-scale))_var(--v2-border-border-muted)] focus-visible:[outline:calc(2px/var(--board-scale))_solid_var(--v2-border-border-focus)] data-[board-drawing]:[outline:calc(2px/var(--board-scale))_solid_var(--v2-background-bg-accent)] data-[board-drawing]:[outline-offset:calc(4px/var(--board-scale))]"
      style={{
        left: `${props.rect.x}px`,
        top: `${props.rect.y}px`,
        width: `${props.rect.width}px`,
        height: `${props.rect.height}px`,
      }}
      onClick={() => props.onOpen()}
    >
      <Show
        when={live && !large()}
        fallback={
          <DesignFrame
            design={props.design}
            title={props.title}
            class="pointer-events-none block size-full border-0"
            preview
          />
        }
      >
        <LiveDesignFrame
          design={props.design}
          title={props.title}
          class="pointer-events-none block size-full border-0"
        />
      </Show>
    </button>
  )
}

/**
 * A board's screen-size label. The title comes first: "Use this one" joins when it fits beside the
 * whole title, then "Done" when that fits too (both stay in the large view). Text widths don't change
 * with zoom, so each part is measured once, laid out but hidden while it doesn't fit.
 */
function BoardLabel(props: {
  boardKey: string
  title: string
  streaming: boolean
  x: number
  y: number
  width: number
  onUse: () => void
}) {
  const language = useLanguage()
  const [size, setSize] = createStore({ title: 0, use: 0, done: 0 })
  let title!: HTMLSpanElement
  let use: HTMLSpanElement | undefined
  let done: HTMLSpanElement | undefined
  createEffect(
    on(
      () => [props.title, props.streaming] as const,
      () =>
        setSize({
          title: title.scrollWidth,
          use: use?.offsetWidth ?? 0,
          done: done?.offsetWidth ?? 0,
        }),
    ),
  )
  const showUse = () => !props.streaming && props.width >= size.title + LABEL_GAP + size.use
  const showDone = () => showUse() && props.width >= size.title + LABEL_GAP + size.use + LABEL_GAP + size.done
  return (
    <div
      data-slot="board-label"
      data-board-key={props.boardKey}
      class="absolute left-0 top-0 flex h-5 items-center gap-2 pb-0.5 text-[12px] leading-4"
      style={{
        transform: `translate(${props.x}px, calc(${props.y}px - 100%))`,
        width: `${props.width}px`,
      }}
    >
      <span ref={title} data-slot="board-label-title" class="min-w-0 truncate text-v2-text-text-base [font-weight:500]">
        {props.title}
      </span>
      <Show
        when={!props.streaming}
        fallback={<span class="shrink-0 text-v2-text-text-muted">{language.t("secondBrain.canvas.drawingCard")}</span>}
      >
        <span
          ref={done}
          aria-hidden={showDone() ? undefined : "true"}
          class="shrink-0 text-v2-text-text-muted"
          classList={{ "invisible absolute": !showDone() }}
        >
          {language.t("secondBrain.canvas.done")}
        </span>
        {/* The wrapper takes the hidden state: the button's own CSS keeps it position: relative. */}
        <span
          ref={use}
          data-slot="board-label-use"
          class="ml-auto flex shrink-0"
          classList={{ "invisible absolute": !showUse() }}
          aria-hidden={showUse() ? undefined : "true"}
        >
          <ButtonV2
            size="small"
            variant="ghost"
            class="h-5"
            classList={{ "pointer-events-auto": showUse() }}
            tabIndex={showUse() ? undefined : -1}
            onPointerDown={(event: PointerEvent) => event.stopPropagation()}
            onClick={() => props.onUse()}
          >
            {language.t("secondBrain.canvas.use")}
          </ButtonV2>
        </span>
      </Show>
    </div>
  )
}
