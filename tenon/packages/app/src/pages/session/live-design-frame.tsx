import { Show, createEffect, on, onCleanup } from "solid-js"
import {
  DESIGN_SANDBOX,
  designDocument,
  designTooLarge,
  type CanvasDesign,
  type Design,
} from "@tenon/session-ui/design-fence"
import {
  DESIGN_FRAME_MESSAGE,
  hasVisibleMarkup,
  liveDesignDocument,
  partialDesignMarkup,
} from "@tenon/session-ui/design-stream"
import { DESIGN_INSPECT } from "@tenon/session-ui/design-inspect"
import { motionDuration } from "@tenon/ui/v2/motion"
import { useLanguage } from "@/context/language"

const FRAME_INTERVAL = 125

type Inspect = { inspect?: boolean; onInspect?: (data: unknown) => void }

function connectInspect(frame: () => HTMLIFrameElement | undefined, props: Inspect) {
  const tell = () => frame()?.contentWindow?.postMessage({ type: DESIGN_INSPECT, on: !!props.inspect }, "*")
  createEffect(on(() => props.inspect, tell, { defer: true }))
  const listen = (event: MessageEvent) => {
    if (event.source === frame()?.contentWindow) props.onInspect?.(event.data)
  }
  window.addEventListener("message", listen)
  onCleanup(() => window.removeEventListener("message", listen))
  return tell
}

export function LiveDesignFrame(props: { design: CanvasDesign; title: string; class: string } & Inspect) {
  const state = {
    frame: undefined as HTMLIFrameElement | undefined,
    ready: false,
    done: false,
    last: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }
  const post = () => {
    state.timer = undefined
    const source = props.design.source
    if (!state.ready || state.done || !hasVisibleMarkup(source)) return
    state.last = performance.now()
    state.frame?.contentWindow?.postMessage({ type: DESIGN_FRAME_MESSAGE, markup: partialDesignMarkup(source) }, "*")
  }
  createEffect(
    on(
      () => [props.design.source, props.design.streaming] as const,
      ([source, streaming]) => {
        if (state.done || !state.frame) return
        if (!streaming) {
          state.done = true
          clearTimeout(state.timer)
          state.frame.srcdoc = designDocument(source, { inspect: props.onInspect !== undefined })
          return
        }
        if (state.timer) return
        state.timer = setTimeout(post, Math.max(0, FRAME_INTERVAL - (performance.now() - state.last)))
      },
    ),
  )
  onCleanup(() => clearTimeout(state.timer))
  const tell = connectInspect(() => state.frame, props)
  return (
    <iframe
      ref={(el) => {
        el.setAttribute("sandbox", DESIGN_SANDBOX)
        const style = getComputedStyle(document.documentElement)
        el.srcdoc = liveDesignDocument({
          duration: motionDuration("medium"),
          easing: style.getPropertyValue("--v2-ease-emphasized-decelerate").trim(),
          accent: style.getPropertyValue("--v2-background-bg-accent").trim(),
        })
        el.addEventListener("load", () => {
          if (state.done) return tell()
          state.ready = true
          post()
        })
        state.frame = el
      }}
      referrerpolicy="no-referrer"
      title={props.title}
      data-live-design={props.design.streaming ? "drawing" : "done"}
      class={props.class}
    />
  )
}

export function DesignFrame(
  props: {
    design: Design
    title: string
    class: string
    style?: Record<string, string>
    preview?: boolean
  } & Inspect,
) {
  const language = useLanguage()
  let frame: HTMLIFrameElement | undefined
  const tell = connectInspect(() => frame, props)
  return (
    <Show
      when={!designTooLarge(props.design.source)}
      fallback={
        <div class="flex size-full items-center justify-center p-4 text-center text-[13px] text-v2-text-text-muted bg-v2-background-bg-layer-01">
          {language.t("secondBrain.canvas.tooLarge")}
        </div>
      }
    >
      <iframe
        ref={(el) => {
          el.setAttribute("sandbox", DESIGN_SANDBOX)
          el.srcdoc = designDocument(props.design.source, { inspect: props.onInspect !== undefined })
          el.addEventListener("load", tell)
          frame = el
        }}
        referrerpolicy="no-referrer"
        loading="lazy"
        title={props.title}
        tabIndex={props.preview ? -1 : undefined}
        class={props.class}
        style={props.style}
      />
    </Show>
  )
}
