import { useNavigate, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createEffect, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { PageFrame, PageHeader } from "@/components/page"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { AgentHands, createWaitingQueue } from "@/features/command-centre/agent-hands-view"
import { AgentPanel } from "@/features/command-centre/agent-panel"
import { useCommandCentre } from "@/features/command-centre/command-centre"
import { createMissionThreads, MissionBoard } from "@/features/command-centre/mission-board-view"
import { Workflows } from "@/features/command-centre/workflows-view"
import { sessionHref } from "@/utils/session-route"

/**
 * The Command Centre. The header switches between three views and links to Routines:
 * - Mission control: the agent (its newest thread's exchange, a composer, and its own threads and memory) beside
 *   the board of every Project's threads.
 * - Waiting on you: the queue of approvals and questions, the Projects' permission modes, and beside them what the
 *   agent did on the user's behalf today.
 * - Workflows: the saved workflows and runs beside the selected workflow's editor or run.
 * A Command Centre thread opens in the thread view, like a Project thread but without review, files or terminal.
 * `/command?thread=<session id>` (older links, the strip's "Open full") opens that thread.
 */
export default function CommandCentrePage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const server = useServer()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  // The provider outlives this page, so catch up on what changed while it was closed.
  onMount(() => void centre.refetch())
  const [search] = useSearchParams<{ thread?: string }>()
  const [state, setState] = createStore({
    view: "board" as "board" | "waiting" | "workflows",
    // The workflow run shown in the Workflows view, and the Project the board is asked to show.
    run: undefined as string | undefined,
    project: undefined as string | undefined,
  })
  const open = (sessionID: string) => navigate(sessionHref(server.key, sessionID))
  const board = createMissionThreads(ctrl)
  const queue = createWaitingQueue(ctrl, board)
  createEffect(() => {
    if (search.thread) navigate(sessionHref(server.key, search.thread), { replace: true })
  })

  return (
    <PageFrame labelledBy="command-centre-title" scroll={false}>
      <PageHeader
        id="command-centre-title"
        title={language.t("secondBrain.commandCentre.title")}
        actions={
          <>
            <SegmentedControlV2
              aria-label={language.t("secondBrain.commandCentre.hands.view")}
              value={state.view}
              onChange={(value) =>
                setState({
                  view: value === "waiting" || value === "workflows" ? value : "board",
                  project: undefined,
                })
              }
            >
              <SegmentedControlItemV2 value="board" data-action="command-view">
                {language.t("secondBrain.commandCentre.board.title")}
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="waiting" data-action="command-view">
                {language.t("secondBrain.commandCentre.hands.waiting")}
                <Show when={queue().length > 0}>
                  <span class="ml-1.5 tabular-nums">{queue().length}</span>
                </Show>
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="workflows" data-action="command-view">
                {language.t("secondBrain.workflows.title")}
              </SegmentedControlItemV2>
            </SegmentedControlV2>
            <ButtonV2 variant="ghost" icon="refresh" onClick={() => navigate("/routines")}>
              {language.t("secondBrain.routines.title")}
            </ButtonV2>
          </>
        }
      />
      <div class="@container flex min-h-0 flex-1 flex-col px-3 pb-3">
        <Switch>
          <Match when={state.view === "workflows"}>
            <Workflows
              ctrl={ctrl}
              started={() => setState("view", "board")}
              run={state.run}
              selectRun={(run) => setState("run", run)}
              open={open}
              showProject={(project) => setState({ view: "board", project })}
            />
          </Match>
          <Match when={state.view === "waiting"}>
            <AgentHands ctrl={ctrl} queue={queue()} open={open} />
          </Match>
          <Match when={true}>
            <div class="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto @[900px]:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] @[900px]:overflow-hidden">
              <AgentPanel open={open} />
              <MissionBoard
                ctrl={ctrl}
                threads={board()}
                open={open}
                openRun={(run) => setState({ view: "workflows", run })}
                focusProject={state.project}
              />
            </div>
          </Match>
        </Switch>
      </div>
    </PageFrame>
  )
}
