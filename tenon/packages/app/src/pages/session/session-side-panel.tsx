import { For, Match, Show, Switch, createEffect, createMemo, on, onCleanup, onMount, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore, reconcile } from "solid-js/store"
import { DragDropProvider as DndKitProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { ResizeHandle } from "@tenon/ui/resize-handle"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { TabsV2 } from "@tenon/ui/v2/tabs-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { ViewSwitch } from "@tenon/ui/v2/view-switch"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { useDialog } from "@tenon/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { normalizeFileTreeV2Path } from "@/components/file-tree-v2-model"

const reviewTabPanelID = "session-side-panel-review-tabpanel"
const fileBrowserTabPanelID = "session-side-panel-file-browser-tabpanel"
import { SessionContextTab, SortableTabV2 } from "@/components/session"
import { OpenInAppV2 } from "@/components/session/open-in-app-v2"
import { SessionTabClose } from "@/components/session/session-tab-close"
import { AgentsTab, useThreadSubagents } from "@/components/session/subagent-tab"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import {
  CANVAS_TAB,
  BROWSER_TAB,
  DEVICE_TAB,
  SESSION_OPEN_FILE_TAB,
  AGENTS_TAB,
  createOpenSessionFileTab,
  migrateAgentTabs,
  selectAgent,
  selectedAgent,
  createSessionTabs,
  shouldShowFileTree,
  type Sizing,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { panelSettled } from "@/pages/session/file-reference"
import { pagePanelClass } from "@/components/page"
import { SessionFileBrowserTab, type SessionFileBrowserState } from "@/pages/session/v2/session-file-browser-tab"
import { sideRailReviewTabID } from "@/pages/session/session-side-rail"
import { REVIEW_SIDEBAR_OVERLAY_WIDTH } from "@/pages/session/v2/review-panel-v2-state"
import { SessionCanvasTab } from "@/pages/session/canvas-tab"
import { SessionBrowserTab } from "@/pages/session/browser-tab"
import { SessionDeviceTab } from "@/pages/session/device-tab"

type ReviewDiff = FileDiffInfo | SnapshotFileDiff | VcsFileDiff
type RenderDiff = FileDiffInfo | (SnapshotFileDiff & { file: string }) | VcsFileDiff
const FILE_TREE_WIDTH_MIN = 240

function renderDiff(value: ReviewDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => ReviewDiff[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewHasFocusableContent: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewSidebarToggle?: (disabled: boolean) => JSX.Element
  fileBrowserState?: SessionFileBrowserState & { setNarrow?: (narrow: boolean) => void }
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  /** The panel is sliding out: keep Review mounted, faded and pinned until the thread column has arrived. */
  closing?: boolean
  size: Sizing
  stacked?: boolean
  /** Display name of a harness instance, for agent tabs; undefined when the harness isn't listed. */
  harnessName?: (id: string) => string | undefined
}) {
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const sdk = useSDK()
  const { sessionKey, tabs, view, params } = useSessionLayout()
  const projectDirectory = createMemo(() => sdk().directory)

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const shown = settings.visibility.fileTree

  const reviewOpen = createMemo(() => isDesktop() && (view().reviewPanel.opened() || !!props.closing))
  // Under 1100px the thread can't share the page with both the Projects panel and this one.
  const narrow = createMediaQuery("(max-width: 1099px)")
  createEffect(
    on(
      () => view().reviewPanel.opened(),
      (open) => open && narrow() && layout.sidebar.close(),
    ),
  )
  const fileOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: shown(),
        opened: layout.fileTree.opened(),
      }),
  )
  const open = createMemo(() => reviewOpen() || fileOpen())
  const fileTreeWidth = createMemo(() => Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width()))
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    return `${fileTreeWidth()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${fileTreeWidth()}px` : "0px"))

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalizeFileTreeV2Path(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-[13px] leading-5 text-v2-text-text-muted">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
    fileBrowser: () => !!props.fileBrowserState,
  })
  const contextOpen = tabState.contextOpen
  const openFileOpen = tabState.openFileOpen
  const panelTabs = tabState.panelTabs
  const openedTabs = tabState.openedTabs
  const section = tabState.section
  const subagents = useThreadSubagents(() => section() === "agents")
  // Tab lists saved before the Agents tab held one tab per subagent; fold them in, keeping that agent selected.
  createEffect(() => {
    const migrated = migrateAgentTabs(tabs().all(), tabs().active())
    if (!migrated) return
    if (migrated.selected) selectAgent(sessionKey(), migrated.selected)
    tabs().setAll(migrated.all)
    if (migrated.active !== tabs().active() && migrated.active) tabs().setActive(migrated.active)
  })
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const title = createMemo(() => {
    const value = section()
    if (value === "changes")
      return props.hasReview()
        ? language.t("session.review.filesChanged", { count: props.reviewCount() })
        : language.t("secondBrain.environment.changes")
    if (value === "agents") return language.t("secondBrain.agents.title")
    if (value === "browser") return language.t("secondBrain.browser.title")
    if (value === "device") return language.t("secondBrain.device.title")
    if (value === "canvas") return language.t("secondBrain.canvas.title")
    if (value === "details") return language.t("secondBrain.sessionTab.title")
    return language.t("secondBrain.sidebar.files")
  })

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  let fileFilter: HTMLInputElement | undefined
  let tabList: HTMLDivElement | undefined
  let aside: HTMLElement | undefined

  // A narrow panel floats the review/file tree over the viewer instead of squeezing the viewer to a sliver.
  onMount(() => {
    if (!aside) return
    createResizeObserver(aside, ({ width }) =>
      props.fileBrowserState?.setNarrow?.(width > 0 && width < REVIEW_SIDEBAR_OVERLAY_WIDTH),
    )
  })

  // Tabs scrolled out of the strip are listed in an overflow menu, so they stay reachable.
  const [overflow, setOverflow] = createStore({ hidden: [] as { value: string; label: string }[] })
  let overflowFrame: number | undefined
  const measureTabs = () => {
    const list = tabList
    if (!list) return
    if (list.scrollWidth <= list.clientWidth + 1) return setOverflow("hidden", reconcile([]))
    const box = list.getBoundingClientRect()
    let start = box.left
    let end = box.right
    // The sidebar toggle sticks to the start; the open-browser and open-file buttons stick to the end.
    for (const child of Array.from(list.children) as HTMLElement[]) {
      if (!child.classList.contains("sticky")) continue
      const rect = child.getBoundingClientRect()
      if (child.classList.contains("left-0")) start = Math.max(start, rect.right)
      else end = Math.min(end, rect.left)
    }
    const hidden: { value: string; label: string }[] = []
    for (const trigger of Array.from(list.querySelectorAll<HTMLElement>('[data-slot="tabs-v2-trigger"]'))) {
      const value = trigger.dataset.value
      if (!value) continue
      const rect = trigger.getBoundingClientRect()
      if (rect.left >= start - 1 && rect.right <= end + 1) continue
      hidden.push({ value, label: trigger.textContent?.trim() || value })
    }
    setOverflow("hidden", reconcile(hidden))
  }
  const scheduleMeasureTabs = () => {
    if (overflowFrame !== undefined) return
    overflowFrame = requestAnimationFrame(() => {
      overflowFrame = undefined
      measureTabs()
    })
  }
  const watchTabOverflow = (list: HTMLDivElement) => {
    list.addEventListener("scroll", scheduleMeasureTabs, { passive: true })
    const resize = new ResizeObserver(scheduleMeasureTabs)
    resize.observe(list)
    const mutation = new MutationObserver(scheduleMeasureTabs)
    mutation.observe(list, { childList: true, subtree: true, characterData: true })
    scheduleMeasureTabs()
    return () => {
      list.removeEventListener("scroll", scheduleMeasureTabs)
      resize.disconnect()
      mutation.disconnect()
      if (overflowFrame !== undefined) cancelAnimationFrame(overflowFrame)
      overflowFrame = undefined
    }
  }
  const revealTab = (value: string) => {
    activateTab(value)
    requestAnimationFrame(() =>
      Array.from(tabList?.querySelectorAll<HTMLElement>('[data-slot="tabs-v2-trigger"]') ?? [])
        .find((trigger) => trigger.dataset.value === value)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }),
    )
  }
  const temporaryTab = tabs().preview
  const previewTab = (value: string) => {
    const next = normalizeTab(value)
    tabs().previewTab(next)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    queueMicrotask(() => tabs().setActive(next))
  }
  const openFileBrowser = () => {
    previewTab(SESSION_OPEN_FILE_TAB)
    queueMicrotask(() => fileFilter?.focus())
  }
  const activateTab = (value: string) => {
    const next = normalizeTab(value)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    tabs().setActive(next)
  }
  const browserTab = createMemo(() => {
    if (!props.fileBrowserState) return undefined
    const active = activeTab()
    if (active === SESSION_OPEN_FILE_TAB) return SESSION_OPEN_FILE_TAB
    if (active && file.pathFromTab(active)) return active
    return activeFileTab()
  })
  // Keep the file-browser shell mounted while any file tab exists. Kobalte briefly
  // selects Review while the tab For replaces a preview trigger, which would
  // otherwise dispose the sidebar and reset scroll.
  const fileBrowserMounted = createMemo(() => {
    if (!props.fileBrowserState) return false
    return openedTabs().length > 0 || openFileOpen() || !!browserTab()
  })
  const fileBrowserVisible = createMemo(() => {
    const active = activeTab()
    return (
      active !== "review" &&
      active !== "context" &&
      active !== CANVAS_TAB &&
      active !== BROWSER_TAB &&
      active !== DEVICE_TAB &&
      active !== "empty" &&
      active !== AGENTS_TAB
    )
  })
  const openFileKeybind = createMemo(() => command.keybindParts("file.open"))
  const reviewToggleKeybind = createMemo(() => command.keybindParts("review.toggle"))
  const closeTabKeybind = createMemo(() => command.keybindParts("tab.close"))
  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  const closeButton = (tab: string) => (
    <SessionTabClose
      label={language.t("common.closeTab")}
      keybind={closeTabKeybind()}
      onClose={() => tabs().close(tab)}
    />
  )

  // Tabs opened after the strip has mounted fade and rise in; the tabs it opens with do not.
  const strip = { ready: false }
  onMount(() => requestAnimationFrame(() => (strip.ready = true)))
  const tabEnter = () => (strip.ready ? "animate-enter" : undefined)

  const agentContent = () => (
    <Show when={activeTab() === AGENTS_TAB}>
      <TabsV2.Content value={AGENTS_TAB} class="flex min-h-0 flex-col !overflow-hidden contain-strict">
        <div class="relative flex-1 min-h-0 overflow-hidden">
          <AgentsTab
            groups={subagents()}
            selected={selectedAgent(sessionKey())}
            onSelect={(partID) => selectAgent(sessionKey(), partID)}
            harnessName={props.harnessName}
          />
        </div>
      </TabsV2.Content>
    </Show>
  )

  const browserContent = () => (
    <Show when={activeTab() === BROWSER_TAB}>
      <TabsV2.Content value={BROWSER_TAB} class="flex min-h-0 flex-col !overflow-hidden contain-strict">
        <div class="relative flex-1 min-h-0 overflow-hidden pt-2">
          <SessionBrowserTab />
        </div>
      </TabsV2.Content>
    </Show>
  )

  const deviceContent = () => (
    <Show when={activeTab() === DEVICE_TAB}>
      <TabsV2.Content value={DEVICE_TAB} class="flex min-h-0 flex-col !overflow-hidden contain-strict">
        <div class="relative flex-1 min-h-0 overflow-hidden pt-2">
          <SessionDeviceTab />
        </div>
      </TabsV2.Content>
    </Show>
  )

  const canvasContent = () => (
    <Show when={activeTab() === CANVAS_TAB}>
      <TabsV2.Content value={CANVAS_TAB} class="flex min-h-0 flex-col !overflow-hidden contain-strict">
        <div class="relative flex-1 min-h-0 overflow-hidden">
          <SessionCanvasTab />
        </div>
      </TabsV2.Content>
    </Show>
  )

  const openFileTrigger = () => (
    <TabsV2.Trigger
      value={SESSION_OPEN_FILE_TAB}
      class={tabEnter()}
      onMiddleClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
    >
      <Icon name="magnifying-glass" size="small" />
      <span class="italic">{language.t("command.file.open")}</span>
      {closeButton(SESSION_OPEN_FILE_TAB)}
    </TabsV2.Trigger>
  )

  const openFileButton = (onClick: () => void) => (
    <div class="sticky right-0 z-10 flex h-8 shrink-0 items-center bg-v2-background-bg-base pl-1">
      <TooltipV2
        value={
          <>
            {language.t("command.file.open")}
            <Show when={openFileKeybind().length > 0}>
              <KeybindV2 keys={openFileKeybind()} variant="neutral" />
            </Show>
          </>
        }
        placement="bottom"
        class="flex items-center"
      >
        <IconButtonV2
          icon={<Icon name="plus" />}
          variant="ghost-muted"
          size="large"
          onClick={onClick}
          aria-label={language.t("command.file.open")}
        />
      </TooltipV2>
    </div>
  )

  const overflowMenu = () => (
    <Show when={overflow.hidden.length > 0}>
      <MenuV2 gutter={6} modal={false} placement="bottom-end">
        <MenuV2.Trigger
          as={IconButtonV2}
          variant="ghost-muted"
          size="large"
          class="shrink-0"
          data-action="side-panel-tab-overflow"
          icon={<Icon name="outline-dots" />}
          aria-label={language.t("secondBrain.sidePanel.moreTabs")}
          title={language.t("secondBrain.sidePanel.moreTabs")}
        />
        <MenuV2.Portal>
          <MenuV2.Content>
            <For each={overflow.hidden}>
              {(tab) => (
                <MenuV2.Item onSelect={() => revealTab(tab.value)}>
                  <span class="truncate">{tab.label}</span>
                </MenuV2.Item>
              )}
            </For>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )

  const hideButton = () => (
    <TooltipV2
      value={
        <>
          {language.t("secondBrain.sidePanel.hide")}
          <Show when={reviewToggleKeybind().length > 0}>
            <KeybindV2 keys={reviewToggleKeybind()} variant="neutral" />
          </Show>
        </>
      }
      placement="bottom"
      class="flex shrink-0 items-center"
    >
      <IconButtonV2
        icon={<Icon name="chevron-right" />}
        variant="ghost-muted"
        size="large"
        onClick={() => view().reviewPanel.close()}
        aria-label={language.t("secondBrain.sidePanel.hide")}
        aria-controls="review-panel"
        aria-expanded={true}
      />
    </TooltipV2>
  )

  const selectToOpen = () => (
    <Show when={activeTab() === "empty"}>
      <TabsV2.Content value="empty" class="flex min-h-0 flex-col !overflow-hidden contain-strict">
        <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center">
          <div class="max-w-56 text-[13px] leading-5 text-v2-text-text-muted">
            {language.t("session.files.selectToOpen")}
          </div>
        </div>
      </TabsV2.Content>
    </Show>
  )

  const contextContent = () => (
    <Show when={activeTab() === "context"}>
      <TabsV2.Content value="context" class="flex min-h-0 flex-col !overflow-hidden contain-strict">
        <div class="relative flex-1 min-h-0 overflow-hidden">
          <SessionContextTab />
        </div>
      </TabsV2.Content>
    </Show>
  )

  // A drag on the thread/panel split, or the panel sliding out, pins the panel's content at its starting width
  // and lets the panel clip it.
  // Re-wrapping the diff at every width costs a frame or more, so the content reflows once, on release.
  let content: HTMLDivElement | undefined
  createEffect(
    on(
      () => props.size.active() || !!props.closing,
      (active) => {
        if (!content) return
        content.style.flex = active ? `0 0 ${content.offsetWidth}px` : ""
      },
      { defer: true },
    ),
  )

  const reviewContent = () => (
    <Show when={reviewTab() && props.canReview() && activeTab() === "review"}>
      <div
        id={reviewTabPanelID}
        role="tabpanel"
        aria-labelledby={sideRailReviewTabID}
        tabIndex={props.reviewHasFocusableContent() ? undefined : 0}
        class="flex flex-1 min-h-0 flex-col overflow-hidden contain-strict focus-visible:outline-none"
      >
        {props.reviewPanel()}
      </div>
    </Show>
  )

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        ref={aside}
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open() || props.closing}
        class={`relative min-w-0 flex overflow-hidden ${pagePanelClass}`}
        classList={{
          "h-full shrink-0": !props.stacked,
          "h-full min-h-0": props.stacked,
          "pointer-events-none": !open(),
          // The same curve as the thread column, so the two edges move together.
          "transition-[width] duration-medium ease-emphasized-decelerate will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
          "flex-1": reviewOpen(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={open()}>
          {/* Mounted at once so files load, but shown only once the sliding panel has arrived. */}
          <div
            ref={content}
            class="size-full flex transition-opacity duration-medium ease-emphasized-decelerate motion-reduce:transition-none"
            classList={{ "opacity-0": !panelSettled() || !!props.closing }}
          >
            <Show when={reviewOpen()}>
              <div class="relative min-w-0 h-full flex-1 overflow-hidden bg-v2-background-bg-base">
                <div class="size-full min-w-0 h-full bg-v2-background-bg-base">
                  <Show when={props.fileBrowserState}>
                    <DndKitProvider
                      sensors={[
                        PointerSensor.configure({
                          activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                          preventActivation: (event) =>
                            event.target instanceof Element &&
                            (!!event.target.closest('[data-slot="tabs-v2-close-button"]') ||
                              !!event.target.closest(".session-review-v2-open-in-app-slot")),
                        }),
                      ]}
                      modifiers={[
                        RestrictToHorizontalAxis,
                        RestrictToElement.configure({ element: () => tabList ?? null }),
                      ]}
                      plugins={(defaults) => [
                        ...defaults.filter((plugin) => plugin !== Accessibility),
                        AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
                        Feedback.configure({ dropAnimation: null }),
                      ]}
                      onDragEnd={(event) => {
                        const source = event.operation.source
                        if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                        tabs().move(source.id.toString(), source.index)
                      }}
                    >
                      <TabsV2
                        class="thread-tabs"
                        value={activeTab()}
                        // The strip holds file tabs only. Outside Files none of them is selected, and Kobalte then
                        // picks the first one itself; that pick must not pull the panel back to Files.
                        onChange={(value: string) => section() === "files" && activateTab(value)}
                      >
                        <div class="sticky top-0 shrink-0 flex items-center gap-1 bg-v2-background-bg-base px-2.5 pt-2.5 pb-1.5">
                          <Show when={section() !== "files"}>
                            {/* Read from props, not a Show accessor: the section can change under this row
                                (a thread switch), and a stale accessor throws. */}
                            <Show when={section() === "changes" && props.reviewSidebarToggle}>
                              <div class="flex h-8 shrink-0 items-center pr-1">
                                {props.reviewSidebarToggle?.(false)}
                              </div>
                            </Show>
                            <h2
                              data-slot="side-panel-title"
                              class="m-0 min-w-0 flex-1 truncate px-1.5 text-[13px] leading-8 [font-weight:600] text-v2-text-text-base"
                            >
                              {title()}
                            </h2>
                            {openFileButton(() => openFileBrowser())}
                          </Show>
                          <TabsV2.List
                            // Scroll padding keeps a revealed tab clear of the sticky buttons at either edge.
                            class="min-w-0 flex-1 scroll-ps-11 scroll-pe-22"
                            classList={{ "!hidden": section() !== "files" }}
                            ref={(el: HTMLDivElement) => {
                              tabList = el
                              const stop = createFileTabListSync({ el, contextOpen })
                              const unwatch = watchTabOverflow(el)
                              onCleanup(() => {
                                stop()
                                unwatch()
                              })
                            }}
                          >
                            <Show when={props.reviewSidebarToggle}>
                              {(toggle) => (
                                <div class="sticky left-0 z-10 flex h-8 shrink-0 items-center bg-v2-background-bg-base pr-1">
                                  {toggle()(activeTab() === SESSION_OPEN_FILE_TAB)}
                                </div>
                              )}
                            </Show>
                            <For each={panelTabs()}>
                              {(tab) => (
                                <Show
                                  when={tab === SESSION_OPEN_FILE_TAB}
                                  fallback={
                                    <SortableTabV2
                                      tab={tab}
                                      class={tabEnter()}
                                      index={() => tabs().all().indexOf(tab)}
                                      temporary={temporaryTab() === tab}
                                      onTabClose={tabs().close}
                                      onTabDoubleClick={temporaryTab() === tab ? openTab : undefined}
                                    />
                                  }
                                >
                                  {openFileTrigger()}
                                </Show>
                              )}
                            </For>
                            {openFileButton(() => openFileBrowser())}
                          </TabsV2.List>
                          <Show when={section() === "files"}>{overflowMenu()}</Show>
                          <div
                            class="session-review-v2-open-in-app-slot ml-auto flex shrink-0 items-center"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <OpenInAppV2 directory={projectDirectory} />
                          </div>
                          {hideButton()}
                        </div>

                        {/* Review, Context, Canvas and agent tabs fade through on a switch; the Files view below
                            stays mounted and fades in on its own. */}
                        <ViewSwitch
                          key={fileBrowserVisible() ? "files" : activeTab()}
                          class={fileBrowserVisible() ? "hidden" : "flex min-h-0 flex-1 flex-col"}
                        >
                          {reviewContent()}
                          {selectToOpen()}
                          {contextContent()}
                          {canvasContent()}
                          {browserContent()}
                          {deviceContent()}
                          {agentContent()}
                        </ViewSwitch>

                        <Show when={fileBrowserMounted()}>
                          <div
                            id={fileBrowserTabPanelID}
                            role="tabpanel"
                            class="flex-1 min-h-0 overflow-hidden animate-enter"
                            classList={{ hidden: !fileBrowserVisible() }}
                            inert={!fileBrowserVisible() || undefined}
                          >
                            <SessionFileBrowserTab
                              tab={browserTab() ?? activeFileTab() ?? SESSION_OPEN_FILE_TAB}
                              placeholder={
                                (browserTab() ?? activeFileTab() ?? SESSION_OPEN_FILE_TAB) === SESSION_OPEN_FILE_TAB
                              }
                              active={file.pathFromTab(browserTab() ?? activeFileTab() ?? "")}
                              kinds={kinds()}
                              state={props.fileBrowserState!}
                              onSelect={(path) => previewTab(file.tab(path))}
                              onSelectPermanent={(path) => openTab(file.tab(path))}
                              filterRef={(element) => (fileFilter = element)}
                            />
                          </div>
                        </Show>
                      </TabsV2>
                    </DndKitProvider>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={fileOpen()}>
              <div
                id="file-tree-panel"
                class="relative min-w-0 h-full shrink-0 overflow-hidden"
                classList={{
                  "transition-[width] duration-medium ease-emphasized-decelerate will-change-[width] motion-reduce:transition-none":
                    !props.size.active(),
                }}
                style={{ width: treeWidth() }}
              >
                <div
                  class="h-full flex flex-col overflow-hidden group/filetree"
                  classList={{ "border-l border-v2-border-border-muted": reviewOpen() }}
                >
                  <TabsV2 class="thread-tabs" value={fileTreeTab()} onChange={setFileTreeTabValue}>
                    <div class="shrink-0 px-2.5 pt-2.5 pb-1.5">
                      <TabsV2.List>
                        <TabsV2.Trigger value="changes" class="flex-1 justify-center">
                          {language.t("session.review.filesChanged", { count: props.reviewCount() })}
                        </TabsV2.Trigger>
                        <TabsV2.Trigger value="all" class="flex-1 justify-center">
                          {language.t("session.files.all")}
                        </TabsV2.Trigger>
                      </TabsV2.List>
                    </div>
                    <Show when={fileTreeTab() === "changes"}>
                      <TabsV2.Content value="changes" class="px-2 pb-2">
                        <Switch>
                          <Match when={props.hasReview() || !props.diffsReady()}>
                            <Show
                              when={props.diffsReady()}
                              fallback={
                                <div role="status" class="px-3 py-2 text-[13px] text-v2-text-text-muted">
                                  {language.t("common.loading")}
                                  {language.t("common.loading.ellipsis")}
                                </div>
                              }
                            >
                              <FileTree
                                path=""
                                class="pt-1"
                                allowed={diffFiles()}
                                kinds={kinds()}
                                draggable={false}
                                active={props.activeDiff}
                                onFileClick={(node) => props.focusReviewDiff(node.path)}
                              />
                            </Show>
                          </Match>
                        </Switch>
                      </TabsV2.Content>
                    </Show>
                    <Show when={fileTreeTab() === "all"}>
                      <TabsV2.Content value="all" class="px-2 pb-2">
                        <Switch>
                          <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                          <Match when={true}>
                            <FileTree
                              path=""
                              class="pt-1"
                              modified={diffFiles()}
                              kinds={kinds()}
                              onFileClick={(node) => openTab(file.tab(node.path))}
                            />
                          </Match>
                        </Switch>
                      </TabsV2.Content>
                    </Show>
                  </TabsV2>
                </div>
                <Show when={fileOpen()}>
                  <div onPointerDown={() => props.size.start()}>
                    <ResizeHandle
                      direction="horizontal"
                      edge="start"
                      size={fileTreeWidth()}
                      min={FILE_TREE_WIDTH_MIN}
                      max={480}
                      onResize={(width) => {
                        props.size.touch()
                        layout.fileTree.preview(width)
                      }}
                      onResizeEnd={(width) => layout.fileTree.resize(width)}
                    />
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
