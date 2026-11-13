import { THREAD_DRAG_PREFIX } from "@/utils/thread-reference"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
  Switch,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import { createReveal, Reveal } from "@tenon/ui/v2/reveal"
import { PathTooltip, TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettingsDialog } from "@/components/settings-dialog"
import {
  BRAIN_GROUP,
  useSidebarController,
  type SidebarController,
  type SidebarProjectItem,
} from "@/components/sidebar/sidebar-controller"
import { onThreadMenuKey, ThreadMenuItems, type ThreadMenuRun } from "@/components/sidebar/thread-menu"
import { DialogArchivedThreads } from "@/components/sidebar/dialog-archived-threads"
import { DialogInstructions } from "@/components/sidebar/dialog-instructions"
import { DialogAddProject, DialogRemoveProject } from "@/components/sidebar/dialog-project-folder"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"
import type { CardSummary, ThreadState } from "@/features/second-brain/sidebar-grouping"
import { projectForDirectory, type ThreadNode } from "@/features/second-brain/sidebar-threads"
import { createFreshItems } from "@/utils/fresh-items"
import { sessionPinnedAt } from "@/utils/session"
import { sessionHref } from "@/utils/session-route"
import { sessionTitle } from "@/utils/session-title"

// Rows clip, so keyboard focus draws an inset ring on the row: when the row is the button, or while its
// main button (a direct child) has focus. A selected row has no fill of its own: SelectionGlide draws one
// highlight behind it that slides from row to row.
const rowClass =
  "group/row relative grid h-8 w-full min-w-0 shrink-0 cursor-default items-center overflow-hidden rounded-[8px] bg-transparent text-left type-control text-v2-text-text-muted transition-[color] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base active:bg-v2-overlay-simple-overlay-pressed data-[selected]:bg-v2-overlay-simple-overlay-pressed data-[selected]:text-v2-text-text-base data-[selected]:hover:bg-v2-overlay-simple-overlay-pressed data-[selected]:[font-weight:600] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus has-[>button:focus-visible]:outline has-[>button:focus-visible]:outline-2 has-[>button:focus-visible]:-outline-offset-2 has-[>button:focus-visible]:outline-v2-border-border-focus motion-reduce:transition-none"

// Card header actions take no width at rest and open beside the status marks on hover, focus or an open menu.
const headerActionsClass =
  "flex w-0 items-center gap-0.5 overflow-hidden group-hover/row:w-auto group-hover/row:pr-0.5 focus-within:w-auto focus-within:pr-0.5 has-[[data-expanded]]:w-auto has-[[data-expanded]]:pr-0.5"

const groupedCardLabel = {
  "attention:needs": "secondBrain.sidebar.needsYou",
  "attention:running": "secondBrain.sidebar.running",
  "attention:other": "secondBrain.sidebar.otherThreads",
  "recent:today": "secondBrain.sidebar.today",
  "recent:yesterday": "secondBrain.sidebar.yesterday",
  "recent:earlier": "secondBrain.sidebar.earlier",
} as const

export function SecondBrainSidebar() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const openSettings = useSettingsDialog()
  const ctrl = useSidebarController()
  const command = useCommand()
  const dialog = useDialog()
  const global = useGlobal()
  const server = useServer()
  // The palette on every page without its own; thread and draft pages register after this and shadow it.
  command.register("sidebar.palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = server.current
        if (!conn) return
        const ctx = global.ensureServerCtx(conn)
        const { DialogHomeCommandPaletteV2 } = await import("@/components/dialog-command-palette-v2")
        void dialog.show(() => (
          <DialogHomeCommandPaletteV2
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const directory = entry.project?.worktree ?? entry.directory
              ctx.projects.open(directory)
              ctx.projects.touch(directory)
              navigate(sessionHref(entry.server, entry.sessionID))
            }}
          />
        ))
      },
    },
  ])
  // The panel keeps its content while its width collapses, so it never closes as an empty column.
  const panel = createReveal(() => layout.sidebar.opened())
  const path = () => ctrl.location.pathname
  // Routine pages open in the page editor under /projects but belong to the Command Centre.
  const fromRoutines = () => new URLSearchParams(ctrl.location.search).get("from") === "routines"
  const railActive = (id: string, href: string) => {
    if (id === "projects") return path().startsWith("/projects") && !fromRoutines()
    if (id === "command") return path() === href || path() === "/routines" || fromRoutines()
    return path() === href
  }
  const items = () => [
    { id: "overview", icon: "home" as const, label: language.t("secondBrain.sidebar.overview"), href: "/" },
    { id: "projects", icon: "book" as const, label: language.t("secondBrain.sidebar.projects"), href: "/projects" },
    { id: "calendar", icon: "calendar" as const, label: language.t("secondBrain.sidebar.calendar"), href: "/calendar" },
    {
      id: "command",
      icon: "console" as const,
      label: language.t("secondBrain.sidebar.command"),
      href: "/command",
    },
  ]

  return (
    <div
      data-component="second-brain-sidebar"
      data-expanded={layout.sidebar.opened() ? "" : undefined}
      // One container with no surface of its own, flat on the window background: its width grows from the rail
      // (80px) into rail plus panel.
      // Not overflow-hidden, so rail labels can still float past its edge; the panel clips itself.
      classList={{
        // Starts below the title bar, which floats over the window's top; 8px in on the other sides.
        "titlebar-inset-margin m-2 flex min-h-0 shrink-0 transition-[width] motion-reduce:duration-0": true,
        "w-20 duration-medium ease-emphasized-decelerate md:w-[336px]": layout.sidebar.opened(),
        "w-20 duration-short ease-emphasized-accelerate": !layout.sidebar.opened(),
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "width") panel.settle()
      }}
    >
      <nav
        class="flex w-20 shrink-0 flex-col items-center gap-3 pb-4 pt-3"
        aria-label={language.t("secondBrain.sidebar.title")}
      >
        <For each={items()}>
          {(item) => (
            <RailItem
              id={item.id}
              icon={item.icon}
              label={item.label}
              active={railActive(item.id, item.href)}
              onClick={() => navigate(item.href)}
            />
          )}
        </For>
        <RailItem
          id="settings"
          icon="settings-gear"
          label={language.t("sidebar.settings")}
          onClick={() => openSettings()}
        />
      </nav>

      <aside
        aria-label={language.t("secondBrain.sidebar.projectsSection")}
        inert={layout.sidebar.opened() ? undefined : true}
        classList={{
          // The rail stays at every width; the Projects panel needs the room of a md window.
          // It fills what the container leaves beside the rail and fades on the container's timing.
          "hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity motion-reduce:duration-0 md:flex": true,
          "opacity-100 duration-medium ease-emphasized-decelerate": layout.sidebar.opened(),
          "opacity-0 duration-short ease-emphasized-accelerate": !layout.sidebar.opened(),
        }}
      >
        <Show when={panel.mounted()}>
          <div
            data-sidebar-section="projects"
            class="flex min-h-0 w-[256px] flex-1 flex-col overflow-y-auto px-2 pb-3 pt-1"
          >
            <WorkspaceHeader ctrl={ctrl} />
            <Show
              when={ctrl.brainDirectory()}
              fallback={
                <p class="px-3 py-1 type-meta text-v2-text-text-muted">
                  {language.t("secondBrain.sidebar.noWorkspace")}
                </p>
              }
            >
              <Show when={ctrl.folderMissing(ctrl.brainDirectory()!)}>
                <MissingFolder ctrl={ctrl} directory={ctrl.brainDirectory()!} />
              </Show>
              <Show when={ctrl.folderMissing(ctrl.brainDirectory()!) !== true}>
                <GroupTabs ctrl={ctrl} />
                <SelectionGlide ctrl={ctrl}>
                  <Show
                    when={ctrl.grouping() === "project"}
                    fallback={
                      <>
                        <ProjectsFailed ctrl={ctrl} />
                        <GroupedCards ctrl={ctrl} />
                      </>
                    }
                  >
                    {/* Keyed by the Project, not its group: a group is rebuilt on every thread change. */}
                    <For each={ctrl.projects()}>
                      {(project) => (
                        <ProjectGroup
                          ctrl={ctrl}
                          project={project}
                          threads={ctrl.projectThreads().get(project.id) ?? []}
                        />
                      )}
                    </For>
                    <ProjectsFailed ctrl={ctrl} />
                    <Show when={!ctrl.loading() && !ctrl.failed() && ctrl.projects().length === 0}>
                      <p class="px-3 py-1 type-meta text-v2-text-text-muted">
                        {language.t("secondBrain.sidebar.noProjectFolders")}
                      </p>
                    </Show>
                    <ThreadGroup
                      ctrl={ctrl}
                      id={BRAIN_GROUP}
                      label={language.t("secondBrain.sidebar.workspaceThreads")}
                      threads={ctrl.groups().workspace}
                      onNewThread={ctrl.newBrainThread}
                      archivedDirectory={ctrl.brainDirectory()}
                    />
                  </Show>
                </SelectionGlide>
              </Show>
            </Show>
          </div>
        </Show>
      </aside>
    </div>
  )
}

/** Material 3 navigation rail destination: icon in a pill indicator that grows in when selected, label below. */
function RailItem(props: { id: string; icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-sidebar-item={props.id}
      data-selected={props.active ? "" : undefined}
      class="group/rail relative flex w-full justify-center focus-visible:outline-none"
      aria-label={props.label}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      <span class="relative flex h-8 w-14 items-center justify-center rounded-full group-focus-visible/rail:outline group-focus-visible/rail:outline-2 group-focus-visible/rail:outline-offset-2 group-focus-visible/rail:outline-v2-border-border-focus">
        <span
          classList={{
            "absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full transition-[width,background-color] ease-standard motion-reduce:transition-none": true,
            // Selection grows the indicator slowly; a hover answers faster.
            "w-14 bg-v2-background-bg-accent-container duration-long": !!props.active,
            "w-0 duration-medium group-hover/rail:w-14 group-hover/rail:bg-v2-overlay-simple-overlay-hover":
              !props.active,
          }}
        />
        <span class="relative flex text-v2-icon-icon-muted transition-colors duration-short ease-standard group-hover/rail:text-v2-icon-icon-base group-data-[selected]/rail:text-v2-text-text-on-accent-container motion-reduce:transition-none">
          <Icon name={props.icon} size="large" />
        </span>
      </span>
      {/* The name slides out to the right on hover or keyboard focus; the button's aria-label carries it. */}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-[calc(50%+32px)] top-1/2 z-50 -translate-x-2 -translate-y-1/2 scale-90 whitespace-nowrap rounded-full bg-v2-background-bg-base px-2.5 py-1 text-[12px] leading-4 text-v2-text-text-base opacity-0 shadow-[var(--v2-elevation-floating)] [font-weight:500] transition-[opacity,translate,scale] duration-short ease-standard group-hover/rail:translate-x-0 group-hover/rail:scale-100 group-hover/rail:opacity-100 group-focus-visible/rail:translate-x-0 group-focus-visible/rail:scale-100 group-focus-visible/rail:opacity-100 motion-reduce:transition-none"
      >
        {props.label}
      </span>
    </button>
  )
}

/** Shown in place of the Project list when the selected workspace's folder was moved or deleted. */
function MissingFolder(props: { ctrl: SidebarController; directory: string }) {
  const language = useLanguage()
  const action =
    "rounded-full px-2 py-0.5 text-[12px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
  return (
    <div role="alert" data-sidebar-item="folder-missing" class="flex flex-col gap-1 px-3 py-1">
      <p class="text-[12px] text-v2-text-text-critical [font-weight:600]">
        {language.t("secondBrain.sidebar.folderMissing")}
      </p>
      <p class="break-all type-meta text-v2-text-text-muted">
        {language.t("secondBrain.sidebar.folderMissingDescription", { path: props.directory })}
      </p>
      <div class="-ml-2 flex flex-wrap gap-1">
        <button type="button" class={action} onClick={() => props.ctrl.locateWorkspace(props.directory)}>
          {language.t("secondBrain.sidebar.locateFolder")}
        </button>
        <button type="button" class={action} onClick={() => props.ctrl.removeWorkspace(props.directory)}>
          {language.t("secondBrain.sidebar.removeWorkspace")}
        </button>
      </div>
    </div>
  )
}

/** The workspace switcher that heads the sidebar, with the workspace's Project actions. */
function WorkspaceHeader(props: { ctrl: SidebarController }) {
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  // A modal over the current page; the workspace's list refreshes once the folder is linked.
  const addProject = () => {
    const current = server.current
    if (current) void dialog.show(() => <DialogAddProject server={current} onAdd={props.ctrl.addProject} />)
  }
  // Project actions need the folder; a missing one gets locate or remove in the sidebar instead.
  const present = () => {
    const directory = props.ctrl.brainDirectory()
    return directory && props.ctrl.folderMissing(directory) !== true ? directory : undefined
  }
  const name = (directory: string) => {
    const item = props.ctrl.workspaces().find((workspace) => workspace.worktree === directory)
    return item?.name || directory.split(/[\\/]/).filter(Boolean).pop() || directory
  }
  return (
    <div class="flex h-10 shrink-0 items-center gap-1">
      <MenuV2 gutter={4} modal={false} placement="bottom-start" onOpenChange={props.ctrl.setSwitcherOpen}>
        <MenuV2.Trigger
          as="button"
          type="button"
          data-sidebar-item="workspace"
          class="flex min-w-0 items-center gap-1 rounded-full px-3 py-1 text-left type-section text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
          aria-label={language.t("secondBrain.sidebar.switchWorkspace")}
        >
          <span class="min-w-0 truncate">
            {props.ctrl.brainDirectory()
              ? name(props.ctrl.brainDirectory()!)
              : language.t("secondBrain.sidebar.workspace")}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <For each={props.ctrl.workspaces()}>
              {(workspace) => (
                <MenuV2.Item onSelect={() => props.ctrl.selectWorkspace(workspace.worktree)}>
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Show when={workspace.worktree === props.ctrl.brainDirectory()}>
                        <Icon name="check" size="small" />
                      </Show>
                    </span>
                    <PathTooltip
                      placement="right"
                      class="min-w-0"
                      name={name(workspace.worktree)}
                      path={workspace.worktree}
                    >
                      <span class="min-w-0 truncate">{name(workspace.worktree)}</span>
                    </PathTooltip>
                    <Show when={props.ctrl.folderMissing(workspace.worktree)}>
                      <span class="shrink-0 type-meta text-v2-text-text-muted">
                        {language.t("secondBrain.sidebar.folderMissing")}
                      </span>
                    </Show>
                  </span>
                </MenuV2.Item>
              )}
            </For>
            <MenuV2.Item onSelect={props.ctrl.chooseFolder}>{language.t("secondBrain.command.openFolder")}</MenuV2.Item>
            <Show when={present()}>
              {(directory) => (
                <>
                  <MenuV2.Separator />
                  <MenuV2.Item onSelect={() => navigate("/projects?new=1")}>
                    {language.t("secondBrain.projects.new")}
                  </MenuV2.Item>
                  <MenuV2.Item onSelect={addProject}>{language.t("secondBrain.sidebar.addProject")}</MenuV2.Item>
                  <MenuV2.Item onSelect={props.ctrl.scanFolders}>
                    {language.t("secondBrain.sidebar.scanProjects")}
                  </MenuV2.Item>
                  <MenuV2.Separator />
                  <MenuV2.Item onSelect={() => navigate("/projects/overview")}>
                    {language.t("secondBrain.projects.overview.title")}
                  </MenuV2.Item>
                  <MenuV2.Item
                    onSelect={() => dialog.show(() => <DialogInstructions workspaceDirectory={directory()} />)}
                  >
                    {language.t("secondBrain.sidebar.workspaceInstructions")}
                  </MenuV2.Item>
                </>
              )}
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
      <div class="flex-1" />
      <Show when={present()}>
        <TooltipV2 placement="bottom" value={language.t("secondBrain.sidebar.addProject")}>
          <IconButtonV2
            type="button"
            data-sidebar-item="add-project"
            variant="ghost-muted"
            size="large"
            icon={<Icon name="folder-add-left" size="small" />}
            aria-label={language.t("secondBrain.sidebar.addProject")}
            onClick={addProject}
          />
        </TooltipV2>
        <TooltipV2 placement="bottom" value={language.t("secondBrain.sidebar.scanProjects")}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            icon={<Icon name="refresh" size="small" />}
            aria-label={language.t("secondBrain.sidebar.scanProjects")}
            onClick={props.ctrl.scanFolders}
          />
        </TooltipV2>
      </Show>
    </div>
  )
}

function ProjectsFailed(props: { ctrl: SidebarController }) {
  const language = useLanguage()
  return (
    <Show when={props.ctrl.failed()}>
      <div class="flex items-center gap-1 px-3 py-1">
        <p role="alert" class="min-w-0 flex-1 type-meta text-v2-text-text-critical">
          {language.t("common.requestFailed")}
        </p>
        <button
          type="button"
          class="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
          onClick={props.ctrl.retryProjects}
        >
          {language.t("secondBrain.error.retry")}
        </button>
      </div>
    </Show>
  )
}

const groupings = ["project", "attention", "recent"] as const
const groupingLabel = {
  project: "secondBrain.sidebar.groupByProject",
  attention: "secondBrain.sidebar.groupByAttention",
  recent: "secondBrain.sidebar.groupByRecent",
} as const

/** Project, Attention and Recent as text tabs; an underline slides to the chosen one. */
function GroupTabs(props: { ctrl: SidebarController }) {
  const language = useLanguage()
  const tabs: HTMLButtonElement[] = []
  const [ink, setInk] = createStore({ left: 0, width: 0, ready: false })
  const measure = () => {
    const tab = tabs[groupings.indexOf(props.ctrl.grouping())]
    if (tab) setInk({ left: tab.offsetLeft, width: tab.offsetWidth })
  }
  onMount(() => {
    measure()
    // The Attention count and late fonts change a tab's width.
    const observer = new ResizeObserver(measure)
    tabs.forEach((tab) => observer.observe(tab))
    onCleanup(() => observer.disconnect())
    // The underline starts in place, then slides on later changes.
    requestAnimationFrame(() => setInk("ready", true))
  })
  createEffect(on(props.ctrl.grouping, measure, { defer: true }))
  const step = (event: KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const index = (groupings.indexOf(props.ctrl.grouping()) + delta + groupings.length) % groupings.length
    props.ctrl.setGrouping(groupings[index])
    tabs[index]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={language.t("secondBrain.sidebar.groupBy")}
      class="relative mb-1 flex shrink-0 gap-4 border-b border-v2-border-border-muted px-3"
      onKeyDown={step}
    >
      <For each={groupings}>
        {(mode, index) => (
          <button
            ref={(element) => (tabs[index()] = element)}
            type="button"
            role="tab"
            id={`sidebar-tab-${mode}`}
            aria-controls="sidebar-threads"
            aria-selected={props.ctrl.grouping() === mode}
            tabIndex={props.ctrl.grouping() === mode ? 0 : -1}
            class="flex items-center gap-1 pb-2 pt-1.5 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:text-v2-text-text-base aria-selected:text-v2-text-text-base focus-visible:rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
            onClick={() => props.ctrl.setGrouping(mode)}
          >
            {language.t(groupingLabel[mode])}
            <Show when={mode === "attention" && props.ctrl.needsYou()}>
              {(count) => <span class="type-caption text-v2-state-fg-warning [font-weight:600]">{count()}</span>}
            </Show>
          </button>
        )}
      </For>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-v2-text-text-base"
        classList={{
          "transition-[transform,width] duration-medium ease-standard motion-reduce:transition-none": ink.ready,
        }}
        style={{ width: `${ink.width}px`, transform: `translateX(${ink.left}px)` }}
      />
    </div>
  )
}

/**
 * The thread list under the tabs. The selected row carries its own highlight, which appears and disappears at once
 * (no sliding between rows). A switch of tab slides the list in from the side of the new tab.
 */
function SelectionGlide(props: ParentProps<{ ctrl: SidebarController }>) {
  let list!: HTMLDivElement
  createEffect(
    on(
      props.ctrl.grouping,
      (mode, previous) => {
        if (!previous || prefersReducedMotion()) return
        const side = groupings.indexOf(mode) > groupings.indexOf(previous) ? 1 : -1
        list.animate(
          [
            { opacity: 0, transform: `translateX(${side * 12}px)` },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: motionDuration("swap-in"),
            easing: getComputedStyle(list).getPropertyValue("--v2-ease-standard").trim() || "ease-out",
          },
        )
      },
      { defer: true },
    ),
  )
  return (
    <div
      ref={list}
      id="sidebar-threads"
      role="tabpanel"
      aria-labelledby={`sidebar-tab-${props.ctrl.grouping()}`}
      class="relative flex flex-col gap-0.5"
    >
      {props.children}
    </div>
  )
}

/** One mark for rows and card headers. Shape carries the state, so colour is never the only signal. */
function ThreadStatusMark(props: { state: ThreadState }) {
  const language = useLanguage()
  return (
    <Switch>
      <Match when={props.state === "approval"}>
        <span
          data-sidebar-status="approval"
          class="flex shrink-0 items-center text-v2-state-fg-warning"
          role="img"
          aria-label={language.t("secondBrain.activity.run.approval")}
        >
          <Icon name="warning" size="small" />
        </span>
      </Match>
      <Match when={props.state === "running"}>
        <span
          data-sidebar-status="running"
          class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent"
          role="img"
          aria-label={language.t("secondBrain.sidebar.running")}
        />
      </Match>
    </Switch>
  )
}

function CardMarks(props: { summary?: CardSummary }) {
  return (
    <>
      <Show when={props.summary?.approvals}>
        <ThreadStatusMark state="approval" />
      </Show>
      <Show when={props.summary?.running}>
        <ThreadStatusMark state="running" />
      </Show>
    </>
  )
}

/** A group of threads: a header row and its list, flat on the panel. */
function SidebarCard(props: ComponentProps<"div"> & { cardID: string; label: string; summary?: CardSummary }) {
  const language = useLanguage()
  const [local, rest] = splitProps(props, ["cardID", "label", "summary", "children"])
  const running = () => local.summary?.running ?? 0
  return (
    <div
      {...rest}
      data-sidebar-card={local.cardID}
      role="group"
      aria-label={
        running() > 0
          ? language.plural("secondBrain.sidebar.cardRunning", running(), { name: local.label, count: running() })
          : local.label
      }
      class="relative flex shrink-0 flex-col"
    >
      {local.children}
    </div>
  )
}

/** Attention and Recent. Keyed by card ID: cards are rebuilt on every status change, and their rows must stay. */
function GroupedCards(props: { ctrl: SidebarController }) {
  const language = useLanguage()
  return (
    <For
      each={props.ctrl.cards().map((card) => card.id)}
      fallback={
        <p class="px-3 py-1 type-meta text-v2-text-text-muted">{language.t("secondBrain.sidebar.noThreads")}</p>
      }
    >
      {(id) => <GroupedCard ctrl={props.ctrl} id={id as keyof typeof groupedCardLabel} />}
    </For>
  )
}

function GroupedCard(props: { ctrl: SidebarController; id: keyof typeof groupedCardLabel }) {
  const language = useLanguage()
  const card = () => props.ctrl.card(props.id)
  const open = () => props.ctrl.expanded(props.id)
  const label = () => language.t(groupedCardLabel[props.id])
  return (
    <SidebarCard cardID={props.id} label={label()} summary={card()?.summary}>
      <div class={`${rowClass} grid-cols-[1fr]`}>
        <button
          type="button"
          class="flex h-8 min-w-0 items-center gap-1.5 pl-3 pr-3 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.id)}
        >
          <Chevron open={open()} />
          <span class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">{label()}</span>
          <CardMarks summary={card()?.summary} />
          <span class="shrink-0 type-meta text-v2-text-text-muted">{card()?.summary.total ?? 0}</span>
        </button>
      </div>
      <Reveal open={open()} variant="even">
        <Show
          when={props.id === "attention:needs" || props.id === "attention:running"}
          fallback={<ThreadList ctrl={props.ctrl} threads={card()?.threads ?? []} />}
        >
          <InboxCards ctrl={props.ctrl} threads={card()?.threads ?? []} />
        </Show>
      </Reveal>
    </SidebarCard>
  )
}

/** Needs you and Running in Attention: each thread as a card naming its folder and, for an approval, what it waits on. */
function InboxCards(props: { ctrl: SidebarController; threads: ThreadNode<Session>[] }) {
  const language = useLanguage()
  const fresh = createFreshItems()
  return (
    <div class="flex flex-col gap-1.5 px-1 pb-2 pt-0.5">
      <For each={props.threads}>
        {(node) => {
          const enter = fresh(node.session.id)
          const state = () => props.ctrl.subtreeState(node)
          const folder = () =>
            projectForDirectory(props.ctrl.projects(), node.session.directory)?.name ??
            language.t("secondBrain.sidebar.workspaceThreads")
          return (
            <button
              type="button"
              data-sidebar-thread={node.session.id}
              data-sidebar-thread-open
              data-selected={props.ctrl.activeSessionID() === node.session.id ? "" : undefined}
              aria-current={props.ctrl.activeSessionID() === node.session.id ? "page" : undefined}
              class={`relative flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-[12px] bg-v2-background-bg-layer-01 px-3 py-2 text-left shadow-[0_0_0_1px_var(--v2-border-border-muted)] transition-[background-color,box-shadow] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover data-[selected]:shadow-[0_0_0_1px_var(--v2-border-border-focus)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none ${enter ? "animate-enter" : ""}`}
              onClick={() => props.ctrl.openThread(node.session)}
            >
              <Show when={state() === "running"}>
                <span aria-hidden="true" class="sidebar-card-line" />
              </Show>
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate type-control text-v2-text-text-base">
                  {sessionTitle(node.session.title) || node.session.id}
                </span>
                <ThreadStatusMark state={state()} />
              </span>
              <span class="truncate type-meta text-v2-text-text-muted">{folder()}</span>
              <Show when={state() === "approval"}>
                <span class="type-meta text-v2-state-fg-warning">
                  {language.t("secondBrain.activity.run.approval")}
                </span>
              </Show>
            </button>
          )
        }}
      </For>
    </div>
  )
}

// Right-click opens the row's own "…" menu instead of Electron's default one; text fields keep the native menu.
function openRowMenu(event: MouseEvent, open: (value: true) => void) {
  if (
    event.target instanceof Element &&
    event.target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")
  )
    return
  event.preventDefault()
  open(true)
}

function Chevron(props: { open: boolean }) {
  return (
    <span
      class="flex size-4 items-center justify-center text-v2-icon-icon-muted transition-transform duration-medium ease-standard motion-reduce:transition-none"
      classList={{ "-rotate-90": !props.open }}
    >
      <Icon name="chevron-down" size="small" />
    </span>
  )
}

function ProjectGroup(props: { ctrl: SidebarController; project: SidebarProjectItem; threads: ThreadNode<Session>[] }) {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()
  const open = () => props.ctrl.expanded(props.project.id)
  const summary = () => props.ctrl.card(props.project.id)?.summary
  const [menuOpen, setMenuOpen] = createSignal(false)
  // The desktop opens the folder in the system's file manager; the web build has no such action.
  const openFolder = () =>
    platform.openPath?.(props.project.threadDirectory).catch((cause: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      }),
    )
  const openFolderLabel = () =>
    language.t(
      platform.os === "macos"
        ? "secondBrain.sidebar.openFolder.finder"
        : platform.os === "windows"
          ? "secondBrain.sidebar.openFolder.fileExplorer"
          : "secondBrain.sidebar.openFolder.fileManager",
    )
  return (
    <SidebarCard
      data-sidebar-project={props.project.id}
      cardID={props.project.id}
      label={props.project.name}
      summary={summary()}
    >
      <div
        class={`${rowClass} grid-cols-[minmax(0,1fr)_auto]`}
        data-selected={props.ctrl.activeProjectID() === props.project.id && !open() ? "" : undefined}
        onContextMenu={(event) => openRowMenu(event, setMenuOpen)}
      >
        <button
          type="button"
          class="flex h-8 min-w-0 items-center gap-1.5 pl-3 pr-3 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.project.id)}
        >
          <Chevron open={open()} />
          <span
            class="min-w-0 flex-1 truncate type-section"
            classList={{ "text-v2-text-text-base": props.ctrl.activeProjectID() !== props.project.id || open() }}
          >
            {props.project.name}
          </span>
          <span class="flex shrink-0 items-center gap-1.5">
            <CardMarks summary={summary()} />
          </span>
        </button>
        {/* Beside the marks, and no width at rest, so the marks line up with the row marks below. */}
        <div class={headerActionsClass}>
          <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="normal"
              class="focus-visible:!outline-offset-[-2px]"
              icon={<Icon name="plus" size="small" />}
              aria-label={language.t("secondBrain.sidebar.newThread")}
              onClick={() => props.ctrl.newThread(props.project)}
            />
          </TooltipV2>
          <MenuV2 gutter={4} modal={false} placement="bottom-start" open={menuOpen()} onOpenChange={setMenuOpen}>
            <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.projectActions")}>
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="normal"
                class="focus-visible:!outline-offset-[-2px]"
                icon={<Icon name="outline-dots" size="small" />}
                aria-label={language.t("secondBrain.sidebar.projectActions")}
              />
            </TooltipV2>
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={() => props.ctrl.openProjectCard(props.project)}>
                  {language.t("secondBrain.sidebar.openProjectCard")}
                </MenuV2.Item>
                <Show when={platform.openPath}>
                  <MenuV2.Item onSelect={() => void openFolder()}>{openFolderLabel()}</MenuV2.Item>
                </Show>
                <MenuV2.Item
                  onSelect={() =>
                    dialog.show(() => (
                      <DialogArchivedThreads ctrl={props.ctrl} directory={props.project.threadDirectory} />
                    ))
                  }
                >
                  {language.t("secondBrain.sidebar.archivedThreads")}
                </MenuV2.Item>
                <MenuV2.Item
                  onSelect={() => {
                    const workspace = props.ctrl.brainDirectory()
                    if (workspace)
                      dialog.show(() => <DialogInstructions workspaceDirectory={workspace} project={props.project} />)
                  }}
                >
                  {language.t("secondBrain.sidebar.projectInstructions")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item
                  critical
                  onSelect={() =>
                    dialog.show(() => (
                      <DialogRemoveProject
                        name={props.project.name}
                        onRemove={() => props.ctrl.removeProject(props.project)}
                      />
                    ))
                  }
                >
                  {language.t("secondBrain.sidebar.removeProject")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>
      <Reveal open={open()} variant="even">
        <ThreadList ctrl={props.ctrl} threads={props.threads} />
      </Reveal>
    </SidebarCard>
  )
}

function ThreadGroup(props: {
  ctrl: SidebarController
  id: string
  label: string
  threads: ThreadNode<Session>[]
  onNewThread?: () => void
  /** Offers the folder's Archived threads dialog from a "…" menu. */
  archivedDirectory?: string
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const open = () => props.ctrl.expanded(props.id)
  const summary = () => props.ctrl.card(props.id)?.summary
  const [menuOpen, setMenuOpen] = createSignal(false)
  return (
    <SidebarCard data-sidebar-group={props.id} cardID={props.id} label={props.label} summary={summary()}>
      <div
        class={`${rowClass} grid-cols-[minmax(0,1fr)_auto]`}
        onContextMenu={(event) => props.archivedDirectory && openRowMenu(event, setMenuOpen)}
      >
        <button
          type="button"
          class="flex h-8 min-w-0 items-center gap-1.5 pl-3 pr-3 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.id)}
        >
          <Chevron open={open()} />
          <span class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">{props.label}</span>
          <span class="flex shrink-0 items-center gap-1.5">
            <CardMarks summary={summary()} />
          </span>
        </button>
        <div class={headerActionsClass}>
          <Show when={props.onNewThread}>
            {(run) => (
              <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="normal"
                  class="focus-visible:!outline-offset-[-2px]"
                  icon={<Icon name="plus" size="small" />}
                  aria-label={language.t("secondBrain.sidebar.newThread")}
                  onClick={run()}
                />
              </TooltipV2>
            )}
          </Show>
          <Show when={props.archivedDirectory}>
            {(directory) => (
              <MenuV2 gutter={4} modal={false} placement="bottom-start" open={menuOpen()} onOpenChange={setMenuOpen}>
                <MenuV2.Trigger
                  as={IconButtonV2}
                  variant="ghost-muted"
                  size="normal"
                  class="focus-visible:!outline-offset-[-2px]"
                  icon={<Icon name="outline-dots" size="small" />}
                  aria-label={language.t("secondBrain.sidebar.workspaceThreadActions")}
                />
                <MenuV2.Portal>
                  <MenuV2.Content>
                    <MenuV2.Item
                      onSelect={() =>
                        dialog.show(() => <DialogArchivedThreads ctrl={props.ctrl} directory={directory()} />)
                      }
                    >
                      {language.t("secondBrain.sidebar.archivedThreads")}
                    </MenuV2.Item>
                  </MenuV2.Content>
                </MenuV2.Portal>
              </MenuV2>
            )}
          </Show>
        </div>
      </div>
      <Reveal open={open()} variant="even">
        <ThreadList ctrl={props.ctrl} threads={props.threads} />
      </Reveal>
    </SidebarCard>
  )
}

/** A group's threads, flat under its header; the header's + starts a new thread. */
function ThreadList(props: { ctrl: SidebarController; threads: ThreadNode<Session>[] }) {
  const language = useLanguage()
  // The list is rebuilt on every thread change, so `For` recreates its rows. Only a thread that was not
  // listed before animates in; the rows of the first render, and later reorders, do not.
  const fresh = createFreshItems()
  return (
    <div class="flex flex-col">
      <For each={props.threads}>
        {(node) => {
          const enter = fresh(node.session.id)
          return <ThreadRow ctrl={props.ctrl} node={node} depth={0} enter={enter} />
        }}
      </For>
      <Show when={props.threads.length === 0}>
        <p class="py-1 pl-8 type-meta text-v2-text-text-muted">{language.t("secondBrain.sidebar.noThreads")}</p>
      </Show>
    </div>
  )
}

function ThreadRow(props: { ctrl: SidebarController; node: ThreadNode<Session>; depth: number; enter?: boolean }) {
  const language = useLanguage()
  const [editing, setEditing] = createSignal(false)
  const session = () => props.node.session
  const active = () => props.ctrl.activeSessionID() === session().id
  const title = () => sessionTitle(session().title) || session().id
  // A thread still on its placeholder title reads as one, so it does not look like the "New thread" action.
  const untitled = () => !session().title || sessionTitle(session().title) !== session().title
  const pinned = () => sessionPinnedAt(session()) !== undefined
  // Child threads (subagents) show while their parent's lineage is on screen, or when the row's toggle opens them.
  const childrenOpen = () => props.ctrl.childrenOpen(props.node)
  let saved = false
  let input: HTMLInputElement | undefined
  // A rename picked from the menu focuses the input only once the menu has closed: closing returns focus to
  // the "…" trigger, which would blur an already focused input and end the edit straight away.
  let renameFromMenu = false
  const finish = (value: string | undefined) => {
    if (saved) return
    saved = true
    renameFromMenu = false
    setEditing(false)
    if (value !== undefined) void props.ctrl.renameThread(session(), value)
  }
  const [menuOpen, setMenuOpen] = createSignal(false)
  // Each menu item runs from a click or from its single-key hint while the menu has focus.
  const run: ThreadMenuRun = {
    rename: () => {
      renameFromMenu = true
      saved = false
      setEditing(true)
    },
    pin: () => void props.ctrl.setThreadPinned(session(), !pinned()),
    fork: () => void props.ctrl.forkThread(session()),
    export: () => void props.ctrl.exportThread(session()),
    archive: () => void props.ctrl.archiveThread(session()),
    delete: () => props.ctrl.deleteThread(session()),
  }

  return (
    <>
      <div
        data-sidebar-thread={session().id}
        data-selected={active() ? "" : undefined}
        class={`${rowClass} grid-cols-[1fr_auto] ${props.enter ? "animate-enter" : ""}`}
        style={{ "padding-left": `${26 + props.depth * 12}px` }}
        onContextMenu={(event) => openRowMenu(event, setMenuOpen)}
      >
        <Show when={props.ctrl.hasChildren(props.node)}>
          <button
            type="button"
            data-sidebar-thread-children
            class="absolute top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus"
            style={{ left: `${6 + props.depth * 12}px` }}
            aria-expanded={childrenOpen()}
            aria-label={language.t(
              childrenOpen() ? "secondBrain.sidebar.hideSubagents" : "secondBrain.sidebar.showSubagents",
            )}
            onClick={() => props.ctrl.toggleChildren(props.node)}
          >
            <Chevron open={childrenOpen()} />
          </button>
        </Show>
        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              class="flex h-8 min-w-0 items-center gap-1.5 pl-2 pr-1 text-left focus-visible:outline-none"
              data-sidebar-thread-open
              aria-current={active() ? "page" : undefined}
              draggable="true"
              // Dropped on a composer, the thread is attached as a reference.
              onDragStart={(event) => {
                event.dataTransfer?.setData("text/plain", `${THREAD_DRAG_PREFIX}${session().id}\n${title()}`)
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
              }}
              onClick={() => props.ctrl.openThread(session())}
              onDblClick={() => {
                renameFromMenu = false
                saved = false
                setEditing(true)
              }}
            >
              <span class="min-w-0 flex-1 truncate" classList={{ italic: untitled() }}>
                {title()}
              </span>
              <Show when={pinned()}>
                <span
                  data-sidebar-pinned
                  class="flex shrink-0 items-center text-v2-icon-icon-muted"
                  role="img"
                  aria-label={language.t("secondBrain.sidebar.pinned")}
                >
                  <Icon name="pin" size="small" />
                </span>
              </Show>
              <ThreadStatusMark state={props.ctrl.subtreeState(props.node)} />
            </button>
          }
        >
          <input
            ref={(el) => {
              input = el
              if (!renameFromMenu) queueMicrotask(() => el.select())
            }}
            class="mx-1 h-7 min-w-0 rounded-full bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_1px_var(--v2-border-border-base)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
            value={session().title ?? ""}
            aria-label={language.t("secondBrain.sidebar.renameThread")}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") finish(event.currentTarget.value)
              if (event.key === "Escape") finish(undefined)
            }}
            onBlur={(event) => finish(event.currentTarget.value)}
          />
        </Show>
        {/* The "…" stays on the selected row and while its menu is open. */}
        <div
          class="flex items-center pr-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-data-[selected]/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none"
          classList={{ "!opacity-100": menuOpen() }}
        >
          <MenuV2 gutter={4} modal={false} placement="bottom-start" open={menuOpen()} onOpenChange={setMenuOpen}>
            <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.threadActions")}>
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="normal"
                class="focus-visible:!outline-offset-[-2px]"
                icon={<Icon name="outline-dots" size="small" />}
                aria-label={language.t("secondBrain.sidebar.threadActions")}
              />
            </TooltipV2>
            <MenuV2.Portal>
              <MenuV2.Content
                onKeyDown={(event) => onThreadMenuKey(event, run, () => setMenuOpen(false))}
                onCloseAutoFocus={() => {
                  if (!renameFromMenu) return
                  renameFromMenu = false
                  // Kobalte's DropdownMenu.Content focuses the trigger right after this handler even when it is
                  // prevented, so the input takes focus in a microtask, once that has happened.
                  queueMicrotask(() => {
                    input?.focus()
                    input?.select()
                  })
                }}
              >
                <ThreadMenuItems run={run} pinned={pinned()} />
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>
      <Show when={props.node.children.length > 0}>
        <Reveal open={childrenOpen()}>
          <For each={props.node.children}>
            {(child) => <ThreadRow ctrl={props.ctrl} node={child} depth={props.depth + 1} />}
          </For>
        </Reveal>
      </Show>
    </>
  )
}
