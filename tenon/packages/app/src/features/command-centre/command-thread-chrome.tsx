import { useLocation, useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"
import { sessionHref } from "@/utils/session-route"
import { createWaitingQueue } from "./agent-hands-view"
import { useCommandCentre } from "./command-centre"
import { createMissionThreads, MissionBoard } from "./mission-board-view"
import { commandBackState } from "./thread-back"
import { AllArtifactsBoard } from "@/features/artifacts/artifacts-view"

export type CommandView = "board" | "waiting" | "workflows"

/** The Mission panel's width beside a Command Centre thread, in px. */
export const MISSION_PANEL_WIDTH = 380

/** Whether the Mission panel shows beside a Command Centre thread; kept across threads and restarts. */
export function createMissionPanelPref() {
  return persisted(Persist.global("command.mission-panel"), createStore({ open: true }))
}

/**
 * The Command Centre's views and Routines, the same on its page and in its threads: Mission control is the thread
 * view with the board beside it, Waiting on you and Workflows are the page's own views.
 */
export function CommandViews(props: {
  value: CommandView
  onChange: (view: CommandView) => void
  waiting: number
  /** The page shows Routines beside the views; a thread's narrower header leaves it to the page. */
  routines?: boolean
}) {
  const language = useLanguage()
  const navigate = useNavigate()
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <SegmentedControlV2
        aria-label={language.t("secondBrain.commandCentre.hands.view")}
        value={props.value}
        onChange={(value) => value && props.onChange(value === "waiting" || value === "workflows" ? value : "board")}
      >
        <SegmentedControlItemV2 value="board" data-action="command-view">
          {language.t("secondBrain.commandCentre.hub.title")}
        </SegmentedControlItemV2>
        <SegmentedControlItemV2 value="waiting" data-action="command-view">
          {language.t("secondBrain.commandCentre.hands.waiting")}
          <Show when={props.waiting > 0}>
            <span class="ml-1.5 tabular-nums">{props.waiting}</span>
          </Show>
        </SegmentedControlItemV2>
        <SegmentedControlItemV2 value="workflows" data-action="command-view">
          {language.t("secondBrain.workflows.title")}
        </SegmentedControlItemV2>
      </SegmentedControlV2>
      <Show when={props.routines !== false}>
        <ButtonV2 variant="ghost" icon="refresh" onClick={() => navigate("/routines")}>
          {language.t("secondBrain.routines.title")}
        </ButtonV2>
      </Show>
    </div>
  )
}

/**
 * In a Command Centre thread, the title row reads as the Command Centre page: its name, a menu of its threads
 * (the sidebar stays the workspace's) and New thread.
 */
export function CommandThreadTitle(props: { sessionID: string }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const server = useServer()
  const centre = useCommandCentre()
  const current = () => centre.threads().find((thread) => thread.id === props.sessionID)
  const label = (thread: NonNullable<ReturnType<typeof current>>) =>
    centre.label(thread) || language.t("secondBrain.commandCentre.threads.untitled")
  const newThread = async () => {
    const id = await centre.create()
    if (id) navigate(sessionHref(server.key, id))
  }
  return (
    <div data-component="command-thread-title" class="flex min-w-0 flex-1 items-center gap-1">
      <h1 class="shrink-0 truncate px-3 type-toolbar-title text-v2-text-text-base">
        {language.t("secondBrain.commandCentre.title")}
      </h1>
      <MenuV2 gutter={4} modal={false} placement="bottom-start">
        <MenuV2.Trigger
          as={ButtonV2}
          size="small"
          variant="ghost-muted"
          data-action="command-thread-switch"
          class="min-w-0 max-w-[240px]"
        >
          <span class="min-w-0 truncate">
            {current() ? label(current()!) : language.t("secondBrain.commandCentre.threads.untitled")}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="max-h-[60vh] w-[300px] overflow-y-auto">
            <For each={centre.threads()}>
              {(thread) => (
                <MenuV2.Item
                  data-current={thread.id === props.sessionID ? "" : undefined}
                  onSelect={() =>
                    navigate(sessionHref(server.key, thread.id), {
                      state: commandBackState(location.pathname + location.search),
                    })
                  }
                >
                  <span class="min-w-0 flex-1 truncate" classList={{ "font-medium": thread.id === props.sessionID }}>
                    {label(thread)}
                  </span>
                </MenuV2.Item>
              )}
            </For>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
      <TooltipV2 placement="bottom" value={language.t("secondBrain.commandCentre.newThread")}>
        <IconButtonV2
          variant="ghost-muted"
          icon={<Icon name="plus" size="small" />}
          data-action="command-thread-new"
          aria-label={language.t("secondBrain.commandCentre.newThread")}
          onClick={() => void newThread()}
        />
      </TooltipV2>
    </div>
  )
}

/** A Command Centre thread's header actions: the page's views (Mission control is this one) and the Mission panel. */
export function CommandThreadActions(props: { missionOpen: boolean; onMissionToggle: () => void }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const ctrl = useSidebarController()
  const queue = createWaitingQueue(ctrl, createMissionThreads(ctrl))
  return (
    <>
      <CommandViews
        value="board"
        routines={false}
        waiting={queue().length}
        onChange={(view) => view !== "board" && navigate(`/command?view=${view}`)}
      />
      <TooltipV2
        placement="bottom"
        value={language.t(
          props.missionOpen ? "secondBrain.commandCentre.mission.hide" : "secondBrain.commandCentre.mission.show",
        )}
      >
        <IconButtonV2
          variant="ghost-muted"
          icon={<Icon name="sidebar-right" size="small" />}
          data-action="command-mission-toggle"
          aria-pressed={props.missionOpen}
          aria-label={language.t(
            props.missionOpen ? "secondBrain.commandCentre.mission.hide" : "secondBrain.commandCentre.mission.show",
          )}
          onClick={() => props.onMissionToggle()}
        />
      </TooltipV2>
    </>
  )
}

/** The Mission board beside a Command Centre thread: every Project's threads by state, as on Mission control. */
export function CommandMissionPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  const server = useServer()
  const language = useLanguage()
  const ctrl = useSidebarController()
  const board = createMissionThreads(ctrl)
  // Board: every Project's threads. Files: every Project's pinned files, to review and send notes on from here.
  const [view, setView] = createStore({ files: false })
  return (
    <aside
      data-component="command-mission-panel"
      class="flex min-h-0 shrink-0 flex-col"
      style={{ width: `${MISSION_PANEL_WIDTH}px` }}
    >
      <div class="flex shrink-0 px-3 pb-2 pt-1">
        <SegmentedControlV2
          aria-label={language.t("secondBrain.commandCentre.mission.view")}
          value={view.files ? "files" : "board"}
          onChange={(value) => value && setView("files", value === "files")}
        >
          <SegmentedControlItemV2 value="board" data-action="mission-board">
            {language.t("secondBrain.commandCentre.mission.board")}
          </SegmentedControlItemV2>
          <SegmentedControlItemV2 value="files" data-action="mission-files">
            {language.t("secondBrain.canvas.files")}
          </SegmentedControlItemV2>
        </SegmentedControlV2>
      </div>
      <div class="flex min-h-0 flex-1 flex-col [&>*]:flex-1">
        <Show
          when={view.files}
          fallback={
            <MissionBoard
              ctrl={ctrl}
              threads={board()}
              open={(id) =>
                navigate(sessionHref(server.key, id), {
                  state: commandBackState(location.pathname + location.search),
                })
              }
              openRun={(run) => navigate(`/command?view=workflows&run=${encodeURIComponent(run)}`)}
            />
          }
        >
          <AllArtifactsBoard />
        </Show>
      </div>
    </aside>
  )
}
