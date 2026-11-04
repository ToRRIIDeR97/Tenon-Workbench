import { THREAD_DRAG_PREFIX } from "@/utils/thread-reference"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, Match, Show, splitProps, Switch, type ComponentProps } from "solid-js"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { createReveal, Reveal } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { PathTooltip, TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { formatKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettingsDialog } from "@/components/settings-dialog"
import {
  BRAIN_GROUP,
  createSidebarController,
  type SidebarController,
  type SidebarProjectItem,
} from "@/components/sidebar/sidebar-controller"
import { THREAD_MENU_KEYS, threadMenuAction, type ThreadMenuAction } from "@/components/sidebar/thread-menu-keys"
import { DialogArchivedThreads } from "@/components/sidebar/dialog-archived-threads"
import { DialogInstructions } from "@/components/sidebar/dialog-instructions"
import { DialogAddProject, DialogRemoveProject } from "@/components/sidebar/dialog-project-folder"
import { useServer } from "@/context/server"
import { parseGrouping, type CardSummary, type ThreadState } from "@/features/second-brain/sidebar-grouping"
import type { ThreadNode } from "@/features/second-brain/sidebar-threads"
import { createFreshItems } from "@/utils/fresh-items"
import { sessionPinnedAt } from "@/utils/session"
import { sessionTitle } from "@/utils/session-title"

// Rows clip, so keyboard focus draws an inset ring on the row: when the row is the button, or while its
// main button (a direct child) has focus.
const rowClass =
  "group/row relative grid h-9 w-full min-w-0 shrink-0 cursor-default items-center overflow-hidden rounded-full bg-transparent text-left text-[13px] text-v2-text-text-muted [font-weight:400] transition-[background-color,color,border-radius] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base active:rounded-[12px] data-[selected]:bg-v2-background-bg-accent-container data-[selected]:text-v2-text-text-on-accent-container data-[selected]:[font-weight:530] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus has-[>button:focus-visible]:outline has-[>button:focus-visible]:outline-2 has-[>button:focus-visible]:-outline-offset-2 has-[>button:focus-visible]:outline-v2-border-border-focus motion-reduce:transition-none"

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
  const ctrl = createSidebarController()
  // The panel keeps its content while its width collapses, so it never closes as an empty column.
  const panel = createReveal(() => layout.sidebar.opened())
  const path = () => ctrl.location.pathname
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
      // One outlined container: its width grows from the rail (80px + border) into rail plus panel.
      // Not overflow-hidden, so rail labels can still float past its edge; the panel clips itself.
      classList={{
        // Same 8px inset as the page panel beside it, so the two share a top and bottom edge.
        "m-2 flex min-h-0 shrink-0 rounded-[20px] border border-v2-border-border-muted bg-v2-background-bg-base transition-[width] motion-reduce:duration-0": true,
        "w-[82px] duration-medium ease-emphasized-decelerate md:w-[338px]": layout.sidebar.opened(),
        "w-[82px] duration-[200ms] ease-emphasized-accelerate": !layout.sidebar.opened(),
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "width") panel.settle()
      }}
    >
      <nav
        // The rail keeps a grey gradient so it reads apart from the plain neutral panel. It follows the
        // container's corners: all four when it fills the container, only the left ones beside the panel.
        classList={{
          "flex w-20 shrink-0 flex-col items-center gap-3 rounded-[19px] bg-[linear-gradient(to_bottom,var(--v2-background-bg-layer-01),var(--v2-background-bg-deep))] pb-4 pt-3 transition-[border-radius] motion-reduce:duration-0": true,
          "duration-medium ease-emphasized-decelerate md:rounded-r-none": layout.sidebar.opened(),
          "duration-[200ms] ease-emphasized-accelerate": !layout.sidebar.opened(),
        }}
        aria-label={language.t("secondBrain.sidebar.title")}
      >
        <For each={items()}>
          {(item) => (
            <RailItem
              id={item.id}
              icon={item.icon}
              label={item.label}
              active={path() === item.href}
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
          "hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-r-[19px] transition-opacity motion-reduce:duration-0 md:flex": true,
          "opacity-100 duration-medium ease-emphasized-decelerate": layout.sidebar.opened(),
          "opacity-0 duration-[200ms] ease-emphasized-accelerate": !layout.sidebar.opened(),
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
                <p class="px-3 py-1 text-[12px] text-v2-text-text-faint">
                  {language.t("secondBrain.sidebar.noWorkspace")}
                </p>
              }
            >
              <Show when={ctrl.folderMissing(ctrl.brainDirectory()!)}>
                <MissingFolder ctrl={ctrl} directory={ctrl.brainDirectory()!} />
              </Show>
              <Show when={ctrl.folderMissing(ctrl.brainDirectory()!) !== true}>
                <GroupBySwitch ctrl={ctrl} />
                <div class="flex flex-col gap-2">
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
                      <p class="px-3 py-1 text-[12px] text-v2-text-text-faint">
                        {language.t("secondBrain.sidebar.noProjectFolders")}
                      </p>
                    </Show>
                    <ThreadGroup
                      ctrl={ctrl}
                      id={BRAIN_GROUP}
                      label={language.t("secondBrain.sidebar.workspaceThreads")}
                      threads={ctrl.groups().workspace}
                      onNewThread={ctrl.newBrainThread}
                    />
                  </Show>
                </div>
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
        <span class="relative flex text-v2-icon-icon-muted group-data-[selected]/rail:text-v2-text-text-on-accent-container">
          <Icon name={props.icon} size="large" />
        </span>
      </span>
      {/* The name slides out to the right on hover or keyboard focus; the button's aria-label carries it. */}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-[calc(50%+32px)] top-1/2 z-50 -translate-x-2 -translate-y-1/2 scale-90 whitespace-nowrap rounded-full bg-v2-background-bg-layer-01 px-2.5 py-1 text-[12px] text-v2-text-text-base opacity-0 shadow-[var(--v2-elevation-floating)] [font-weight:500] transition-[opacity,translate,scale] duration-short ease-standard group-hover/rail:translate-x-0 group-hover/rail:scale-100 group-hover/rail:opacity-100 group-focus-visible/rail:translate-x-0 group-focus-visible/rail:scale-100 group-focus-visible/rail:opacity-100 motion-reduce:transition-none"
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
      <p class="break-all text-[12px] text-v2-text-text-faint">
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
      <MenuV2 gutter={4} modal={false} placement="bottom-start">
        <MenuV2.Trigger
          as="button"
          type="button"
          data-sidebar-item="workspace"
          class="flex min-w-0 items-center gap-1 rounded-full px-3 py-1 text-left text-[13px] text-v2-text-text-base [font-weight:600] transition-colors hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
          aria-label={language.t("secondBrain.sidebar.switchWorkspace")}
        >
          <span class="min-w-0 truncate">
            {props.ctrl.brainDirectory()
              ? name(props.ctrl.brainDirectory()!)
              : language.t("secondBrain.sidebar.workspace")}
          </span>
          <Icon name="chevron-down" size="small" />
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
                      <span class="shrink-0 text-[12px] text-v2-text-text-faint">
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
        <p role="alert" class="min-w-0 flex-1 text-[12px] text-v2-text-text-critical">
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

function GroupBySwitch(props: { ctrl: SidebarController }) {
  const language = useLanguage()
  return (
    <SegmentedControlV2
      class="segmented-control-v2--full-width mb-2 shrink-0"
      aria-label={language.t("secondBrain.sidebar.groupBy")}
      value={props.ctrl.grouping()}
      onChange={(value) => props.ctrl.setGrouping(parseGrouping(value))}
    >
      <SegmentedControlItemV2 value="project">
        {language.t("secondBrain.sidebar.groupByProject")}
      </SegmentedControlItemV2>
      <SegmentedControlItemV2 value="attention">
        {language.t("secondBrain.sidebar.groupByAttention")}
      </SegmentedControlItemV2>
      <SegmentedControlItemV2 value="recent">{language.t("secondBrain.sidebar.groupByRecent")}</SegmentedControlItemV2>
    </SegmentedControlV2>
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

/** The rounded surface every group of threads sits on. It clips the top line to its corners. */
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
      class="relative flex shrink-0 flex-col overflow-hidden rounded-[16px] bg-v2-background-bg-layer-01 p-1"
    >
      <Show when={running() > 0}>
        <span aria-hidden="true" class="sidebar-card-line" />
      </Show>
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
        <p class="px-3 py-1 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.sidebar.noThreads")}</p>
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
          class="flex h-9 min-w-0 items-center gap-1.5 pl-3 pr-3 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.id)}
        >
          <Chevron open={open()} />
          <span class="min-w-0 flex-1 truncate [font-weight:600]">{label()}</span>
          <CardMarks summary={card()?.summary} />
          <span class="shrink-0 text-[12px] text-v2-text-text-faint">{card()?.summary.total ?? 0}</span>
        </button>
      </div>
      <Reveal open={open()} variant="even">
        <ThreadList ctrl={props.ctrl} threads={card()?.threads ?? []} />
      </Reveal>
    </SidebarCard>
  )
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
  const open = () => props.ctrl.expanded(props.project.id)
  const summary = () => props.ctrl.card(props.project.id)?.summary
  return (
    <SidebarCard
      data-sidebar-project={props.project.id}
      cardID={props.project.id}
      label={props.project.name}
      summary={summary()}
    >
      <div
        class={`${rowClass} grid-cols-[1fr]`}
        data-selected={props.ctrl.activeProjectID() === props.project.id && !open() ? "" : undefined}
      >
        <button
          type="button"
          class="flex h-9 min-w-0 items-center gap-1.5 pl-3 pr-3 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.project.id)}
        >
          <Chevron open={open()} />
          <span
            class="min-w-0 flex-1 truncate [font-weight:600]"
            classList={{ "text-v2-text-text-base": props.ctrl.activeProjectID() === props.project.id }}
          >
            {props.project.name}
          </span>
          <span class="flex shrink-0 items-center gap-1.5 group-hover/row:opacity-0">
            <CardMarks summary={summary()} />
          </span>
        </button>
        {/* Over the row, not beside it, so hidden actions don't push the marks away from the row marks below. */}
        <div class="absolute inset-y-0 right-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
          <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="plus" size="small" />}
              aria-label={language.t("secondBrain.sidebar.newThread")}
              onClick={() => props.ctrl.newThread(props.project)}
            />
          </TooltipV2>
          <MenuV2 gutter={4} modal={false} placement="bottom-start">
            <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.projectActions")}>
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="small"
                icon={<Icon name="outline-dots" size="small" />}
                aria-label={language.t("secondBrain.sidebar.projectActions")}
              />
            </TooltipV2>
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={() => props.ctrl.openProjectCard(props.project)}>
                  {language.t("secondBrain.sidebar.openProjectCard")}
                </MenuV2.Item>
                <MenuV2.Item
                  onSelect={() =>
                    dialog.show(() => <DialogArchivedThreads ctrl={props.ctrl} project={props.project} />)
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
                  class="[--menu-v2-fg:var(--v2-text-text-critical)]"
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
        <ThreadList ctrl={props.ctrl} threads={props.threads} onNewThread={() => props.ctrl.newThread(props.project)} />
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
}) {
  const language = useLanguage()
  const open = () => props.ctrl.expanded(props.id)
  const summary = () => props.ctrl.card(props.id)?.summary
  return (
    <SidebarCard data-sidebar-group={props.id} cardID={props.id} label={props.label} summary={summary()}>
      <div class={`${rowClass} grid-cols-[1fr]`}>
        <button
          type="button"
          class="flex h-9 min-w-0 items-center gap-1.5 pl-3 pr-3 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.id)}
        >
          <Chevron open={open()} />
          <span class="min-w-0 flex-1 truncate [font-weight:600]">{props.label}</span>
          <span class="flex shrink-0 items-center gap-1.5 group-hover/row:opacity-0">
            <CardMarks summary={summary()} />
          </span>
        </button>
        <Show when={props.onNewThread}>
          {(run) => (
            <div class="absolute inset-y-0 right-0.5 flex items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
              <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="plus" size="small" />}
                  aria-label={language.t("secondBrain.sidebar.newThread")}
                  onClick={run()}
                />
              </TooltipV2>
            </div>
          )}
        </Show>
      </div>
      <Reveal open={open()} variant="even">
        <ThreadList ctrl={props.ctrl} threads={props.threads} onNewThread={props.onNewThread} />
      </Reveal>
    </SidebarCard>
  )
}

function ThreadList(props: { ctrl: SidebarController; threads: ThreadNode<Session>[]; onNewThread?: () => void }) {
  const language = useLanguage()
  // The list is rebuilt on every thread change, so `For` recreates its rows. Only a thread that was not
  // listed before animates in; the rows of the first render, and later reorders, do not.
  const fresh = createFreshItems()
  return (
    <div class="flex flex-col">
      <Show when={props.onNewThread}>
        {(run) => (
          <button
            type="button"
            data-sidebar-new-thread
            class={`${rowClass} grid-cols-[1fr] pl-[34px] text-v2-text-text-faint`}
            onClick={run()}
          >
            <span class="flex min-w-0 items-center gap-1.5">
              <Icon name="plus" size="small" />
              <span class="truncate">{language.t("secondBrain.sidebar.newThread")}</span>
            </span>
          </button>
        )}
      </Show>
      <For each={props.threads}>
        {(node) => {
          const enter = fresh(node.session.id)
          return <ThreadRow ctrl={props.ctrl} node={node} depth={0} enter={enter} />
        }}
      </For>
      <Show when={!props.onNewThread && props.threads.length === 0}>
        <p class="py-1 pl-8 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.sidebar.noThreads")}</p>
      </Show>
    </div>
  )
}

const containsSession = (node: ThreadNode<Session>, sessionID: string | undefined): boolean =>
  !!sessionID && (node.session.id === sessionID || node.children.some((child) => containsSession(child, sessionID)))

function ThreadRow(props: { ctrl: SidebarController; node: ThreadNode<Session>; depth: number; enter?: boolean }) {
  const language = useLanguage()
  const [editing, setEditing] = createSignal(false)
  const session = () => props.node.session
  const active = () => props.ctrl.activeSessionID() === session().id
  const title = () => sessionTitle(session().title) || session().id
  const pinned = () => sessionPinnedAt(session()) !== undefined
  // Child threads show while their parent's lineage is on screen.
  const showChildren = () => props.node.children.length > 0 && containsSession(props.node, props.ctrl.activeSessionID())
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
  const run: Record<ThreadMenuAction, () => void> = {
    rename: () => {
      renameFromMenu = true
      saved = false
      setEditing(true)
    },
    pin: () => void props.ctrl.setThreadPinned(session(), !pinned()),
    fork: () => void props.ctrl.forkThread(session()),
    archive: () => void props.ctrl.archiveThread(session()),
    delete: () => props.ctrl.deleteThread(session()),
  }
  const hint = (action: ThreadMenuAction) => formatKeybind(THREAD_MENU_KEYS[action], language.t)

  return (
    <>
      <div
        data-sidebar-thread={session().id}
        data-selected={active() ? "" : undefined}
        class={`${rowClass} grid-cols-[1fr_auto] ${props.enter ? "animate-enter" : ""}`}
        style={{ "padding-left": `${26 + props.depth * 12}px` }}
      >
        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              class="flex h-9 min-w-0 items-center gap-1.5 pl-2 pr-1 text-left focus-visible:outline-none"
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
              <span class="min-w-0 flex-1 truncate">{title()}</span>
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
            class="mx-1 h-7 min-w-0 rounded-full bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
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
        <div class="flex items-center pr-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
          <MenuV2 gutter={4} modal={false} placement="bottom-start" open={menuOpen()} onOpenChange={setMenuOpen}>
            <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.threadActions")}>
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="small"
                icon={<Icon name="outline-dots" size="small" />}
                aria-label={language.t("secondBrain.sidebar.threadActions")}
              />
            </TooltipV2>
            <MenuV2.Portal>
              <MenuV2.Content
                onKeyDown={(event) => {
                  const action = threadMenuAction(event)
                  if (!action) return
                  event.preventDefault()
                  event.stopPropagation()
                  // Same order as a click: the item runs, then the menu closes.
                  run[action]()
                  setMenuOpen(false)
                }}
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
                <MenuV2.Item onSelect={run.rename} shortcut={hint("rename")}>
                  {language.t("common.rename")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={run.pin} shortcut={hint("pin")}>
                  {language.t(pinned() ? "secondBrain.sidebar.unpin" : "secondBrain.sidebar.pin")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={run.fork} shortcut={hint("fork")}>
                  {language.t("secondBrain.sidebar.fork")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={run.archive} shortcut={hint("archive")}>
                  {language.t("common.archive")}
                </MenuV2.Item>
                <MenuV2.Item class="[--menu-v2-fg:var(--v2-text-text-critical)]" onSelect={run.delete} shortcut={hint("delete")}>
                  {language.t("common.delete")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>
      <Show when={props.node.children.length > 0}>
        <Reveal open={showChildren()}>
          <For each={props.node.children}>
            {(child) => <ThreadRow ctrl={props.ctrl} node={child} depth={props.depth + 1} />}
          </For>
        </Reveal>
      </Show>
    </>
  )
}
