import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  type SessionReviewExpandMode,
} from "@tenon/session-ui/v2/session-review-v2"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export const REVIEW_SIDEBAR_OVERLAY_WIDTH = 560

export function createReviewPanelV2State() {
  const [store, setStore, , ready] = persisted(
    Persist.global("review-panel-v2"),
    createStore({
      sidebarOpened: true,
      sidebarWidth: SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
      expandMode: "collapse" as SessionReviewExpandMode,
    }),
  )
  const [filter, setFilter] = createSignal("")
  const [panel, setPanel] = createStore({ narrow: false, overlay: false })
  const narrow = () => panel.narrow

  return {
    sidebarOpened: () => (panel.narrow ? panel.overlay : store.sidebarOpened),
    narrow,
    setNarrow: (value: boolean) => {
      if (value !== panel.narrow) setPanel({ narrow: value, overlay: false })
    },
    closeOverlay: () => setPanel("overlay", false),
    sidebarWidth: () => store.sidebarWidth,
    sidebarTransition: ready,
    filter,
    setFilter,
    expandMode: () => store.expandMode,
    setExpandMode: (mode: SessionReviewExpandMode) => setStore("expandMode", mode),
    resizeSidebar: (width: number) =>
      setStore(
        "sidebarWidth",
        Math.min(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX, Math.max(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, width)),
      ),
    toggleSidebar: () =>
      panel.narrow ? setPanel("overlay", (open) => !open) : setStore("sidebarOpened", (opened) => !opened),
  }
}

export type ReviewPanelV2State = ReturnType<typeof createReviewPanelV2State>
