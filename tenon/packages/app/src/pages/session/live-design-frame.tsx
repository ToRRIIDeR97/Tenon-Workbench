import { createEffect, on, onCleanup } from "solid-js"
import { DESIGN_SANDBOX, designDocument, type CanvasDesign } from "@tenon/session-ui/design-fence"
import {
  DESIGN_FRAME_MESSAGE,
  hasVisibleMarkup,
  liveDesignDocument,
  partialDesignMarkup,
} from "@tenon/session-ui/design-stream"
import { motionDuration } from "@tenon/ui/v2/motion"

// At most 8 frames a second reach the sandbox; the newest source always goes in the next one.
const FRAME_INTERVAL = 125

/**
 * A canvas design drawn while it streams, in one sandboxed frame for its whole life: the frame loads
 * `liveDesignDocument` once and gets the healed markup so far by `postMessage`; when the design is done
 * the frame swaps to `designDocument(source)` once, so the page's own scripts run only then.
 * Mount it only for a design that is streaming; the caller shows the size-cap notice.
 */
export function LiveDesignFrame(props: { design: CanvasDesign; title: string; class: string }) {
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
          state.frame.srcdoc = designDocument(source)
          return
        }
        if (state.timer) return
        state.timer = setTimeout(post, Math.max(0, FRAME_INTERVAL - (performance.now() - state.last)))
      },
    ),
  )
  onCleanup(() => clearTimeout(state.timer))
  return (
    <iframe
      ref={(el) => {
        // Sandboxed before the document is set and before the frame is attached.
        el.setAttribute("sandbox", DESIGN_SANDBOX)
        // The frame can't read the app's tokens, so their values go into its document.
        const style = getComputedStyle(document.documentElement)
        el.srcdoc = liveDesignDocument({
          duration: motionDuration("medium"),
          easing: style.getPropertyValue("--v2-ease-emphasized-decelerate").trim(),
          accent: style.getPropertyValue("--v2-background-bg-accent").trim(),
        })
        el.addEventListener("load", () => {
          if (state.done) return
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
