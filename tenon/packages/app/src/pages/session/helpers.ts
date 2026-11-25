import { batch, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { same } from "@/utils/same"
import { SESSION_OPEN_FILE_TAB } from "@/context/layout-tabs"

export { SESSION_OPEN_FILE_TAB } from "@/context/layout-tabs"

const emptyTabs: string[] = []

type Tabs = {
  active: Accessor<string | undefined>
  all: Accessor<string[]>
}

type TabsInput = {
  tabs: Accessor<Tabs>
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
  review?: Accessor<boolean>
  hasReview?: Accessor<boolean>
  fileBrowser?: Accessor<boolean>
}

export const AGENTS_TAB = "agents"

export const AGENT_TAB_PREFIX = "agent://"
export const isAgentTab = (tab: string | undefined) => !!tab?.startsWith(AGENT_TAB_PREFIX)
export const agentTabPartID = (tab: string) => (isAgentTab(tab) ? tab.slice(AGENT_TAB_PREFIX.length) : undefined)

const [agentSelection, setAgentSelection] = createStore<Record<string, string | undefined>>({})
export const selectedAgent = (sessionKey: string) => agentSelection[sessionKey]
export const selectAgent = (sessionKey: string, partID: string | undefined) => setAgentSelection(sessionKey, partID)

export function migrateAgentTabs(all: readonly string[], active: string | undefined) {
  const legacy = all.filter(isAgentTab)
  if (legacy.length === 0) return undefined
  const next: string[] = []
  for (const tab of all) {
    const value = isAgentTab(tab) ? AGENTS_TAB : tab
    if (!next.includes(value)) next.push(value)
  }
  return {
    all: next,
    active: isAgentTab(active) ? AGENTS_TAB : active,
    selected: agentTabPartID(isAgentTab(active) ? active! : legacy.at(-1)!),
  }
}

export const CANVAS_TAB = "canvas"

export const BROWSER_TAB = "browser"
export const DEVICE_TAB = "device"
export const DOCUMENTS_TAB = "documents"
const toolTabs = new Set([BROWSER_TAB, DEVICE_TAB, DOCUMENTS_TAB])

export type PanelSection = "changes" | "files" | "documents" | "agents" | "browser" | "device" | "canvas" | "details"

export const SECTION_TAB = {
  changes: "review",
  documents: DOCUMENTS_TAB,
  agents: AGENTS_TAB,
  browser: BROWSER_TAB,
  device: DEVICE_TAB,
  canvas: CANVAS_TAB,
  details: "context",
} satisfies Record<Exclude<PanelSection, "files">, string>

const tabSections: Record<string, PanelSection> = {
  review: "changes",
  [DOCUMENTS_TAB]: "documents",
  [AGENTS_TAB]: "agents",
  [BROWSER_TAB]: "browser",
  [DEVICE_TAB]: "device",
  [CANVAS_TAB]: "canvas",
  context: "details",
}

const [attention, setAttention] = createStore<Record<string, Partial<Record<PanelSection, boolean>>>>({})
export const sectionAttention = (sessionKey: string, section: PanelSection) => !!attention[sessionKey]?.[section]
export const setSectionAttention = (sessionKey: string, section: PanelSection, value: boolean) =>
  setAttention(sessionKey, (prev) => ({ ...prev, [section]: value }))

export const getSessionKey = (dir: string | undefined, id: string | undefined) => `${dir ?? ""}${id ? `/${id}` : ""}`

export function shouldShowFileTree(input: { visible: boolean; opened: boolean }) {
  return input.opened && input.visible
}

export const createSessionTabs = (input: TabsInput) => {
  const review = input.review ?? (() => false)
  const hasReview = input.hasReview ?? (() => false)
  const fileBrowser = input.fileBrowser ?? (() => false)
  const contextOpen = createMemo(() => input.tabs().active() === "context" || input.tabs().all().includes("context"))
  const canvasOpen = createMemo(() => input.tabs().active() === CANVAS_TAB || input.tabs().all().includes(CANVAS_TAB))
  const toolOpen = (tab: string) => input.tabs().active() === tab || input.tabs().all().includes(tab)
  const openFileOpen = createMemo(
    () =>
      fileBrowser() &&
      (input.tabs().active() === SESSION_OPEN_FILE_TAB || input.tabs().all().includes(SESSION_OPEN_FILE_TAB)),
  )
  const panelTabs = createMemo(
    () => {
      const seen = new Set<string>()
      return input
        .tabs()
        .all()
        .flatMap((tab) => {
          if (
            tab === "context" ||
            tab === "review" ||
            tab === CANVAS_TAB ||
            tab === AGENTS_TAB ||
            toolTabs.has(tab) ||
            isAgentTab(tab)
          )
            return []
          if (tab === SESSION_OPEN_FILE_TAB && !fileBrowser()) return []
          const value = input.pathFromTab(tab) ? input.normalizeTab(tab) : tab
          if (seen.has(value)) return []
          seen.add(value)
          return [value]
        })
    },
    emptyTabs,
    { equals: same },
  )
  const openedTabs = createMemo(() => panelTabs().filter((tab) => tab !== SESSION_OPEN_FILE_TAB), emptyTabs, {
    equals: same,
  })
  const agentsOpen = createMemo(() =>
    input
      .tabs()
      .all()
      .some((tab) => tab === AGENTS_TAB || isAgentTab(tab)),
  )
  const activeTab = createMemo(() => {
    const active = input.tabs().active()
    if (active === "context" || active === CANVAS_TAB || active === AGENTS_TAB) return active
    if (active && toolTabs.has(active)) return active
    if (active === SESSION_OPEN_FILE_TAB && openFileOpen()) return active
    if (active === "review" && review()) return active
    if (active && input.pathFromTab(active)) return input.normalizeTab(active)
    if (isAgentTab(active) && agentsOpen()) return AGENTS_TAB

    const first = openedTabs()[0] ?? (agentsOpen() ? AGENTS_TAB : undefined)
    if (first) return first
    if (contextOpen()) return "context"
    if (canvasOpen()) return CANVAS_TAB
    if (review() && hasReview()) return "review"
    return "empty"
  })
  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (!openedTabs().includes(active)) return
    return active
  })
  const closableTab = createMemo(() => {
    const active = activeTab()
    if (active === SESSION_OPEN_FILE_TAB && openFileOpen()) return active
    if (!openedTabs().includes(active)) return
    return active
  })
  const section = createMemo<PanelSection>(() => tabSections[activeTab()] ?? "files")

  return {
    section,
    contextOpen,
    canvasOpen,
    browserOpen: () => toolOpen(BROWSER_TAB),
    deviceOpen: () => toolOpen(DEVICE_TAB),
    openFileOpen,
    panelTabs,
    openedTabs,
    agentsOpen,
    activeTab,
    activeFileTab,
    closableTab,
  }
}

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  setActive: (tab: string) => void
  loadFile: (path: string) => any | Promise<void>
}) => {
  return (path: string) => {
    batch(() => {
      input.showAllFiles()
      const maybePromise = input.loadFile(path)
      const open = () => {
        const tab = input.tabForPath(path)
        input.openTab(tab)
        input.setActive(tab)
      }
      if (maybePromise instanceof Promise) void maybePromise.then(open)
      else open()
    })
  }
}

export const createOpenSessionFileTab = (input: {
  normalizeTab: (tab: string) => string
  openTab: (tab: string) => void
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  setActive: (tab: string) => void
}) => {
  return (value: string) => {
    const next = input.normalizeTab(value)
    input.openTab(next)

    const path = input.pathFromTab(next)
    if (!path) return

    input.loadFile(path)
    input.openReviewPanel()
    input.setActive(next)
  }
}

export const createSizing = () => {
  const [state, setState] = createStore({ active: false })
  let t: number | undefined

  const stop = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", false)
  }

  const start = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", true)
  }

  onMount(() => {
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
  })

  onCleanup(() => {
    if (t !== undefined) clearTimeout(t)
  })

  return {
    active: () => state.active,
    start,
    touch() {
      start()
      t = window.setTimeout(stop, 120)
    },
  }
}

export type Sizing = ReturnType<typeof createSizing>
