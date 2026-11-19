import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, Match, on, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { PageFrame, PageHeader } from "@/components/page"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { AgentHands, createWaitingQueue } from "@/features/command-centre/agent-hands-view"
import { AgentPanel } from "@/features/command-centre/agent-panel"
import { useCommandCentre } from "@/features/command-centre/command-centre"
import { CommandViews, type CommandView } from "@/features/command-centre/command-thread-chrome"
import { createMissionThreads, MissionBoard } from "@/features/command-centre/mission-board-view"
import { Workflows } from "@/features/command-centre/workflows-view"
import { sessionHref } from "@/utils/session-route"

/**
 * The Command Centre. The header switches between three views and links to Routines:
 * - Mission control: the newest Command Centre thread in the thread view, with the board of every Project's
 *   threads beside it. Before the first thread there is none to open, so the page shows the agent's composer
 *   beside the board.
 * - Waiting on you: the queue of approvals and questions, the Projects' permission modes, and beside them what the
 *   agent did on the user's behalf today.
 * - Workflows: the saved workflows and runs beside the selected workflow's editor or run.
 * A Command Centre thread opens in the thread view, like a Project thread but without review, files or terminal.
 * `/command?thread=<session id>` (older links, the strip's "Open full") opens that thread; `?view=waiting` or
 * `?view=workflows` (with `&run=<id>`) opens those views, which is how a Command Centre thread's header gets here.
 */
export default function CommandCentrePage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const server = useServer()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  // The provider outlives this page, so catch up on what changed while it was closed.
  onMount(() => void centre.refetch())
  const [search, setSearch] = useSearchParams<{ thread?: string; view?: string; run?: string }>()
  const initial = (): CommandView => (search.view === "waiting" || search.view === "workflows" ? search.view : "board")
  const [state, setState] = createStore({
    view: initial(),
    // The workflow run shown in the Workflows view, and the Project the board is asked to show.
    run: search.run as string | undefined,
    project: undefined as string | undefined,
  })
  // The view lives in the URL too, so a thread's header can link to it and Back returns to it.
  createEffect(
    on(
      () => search.view,
      () => setState("view", initial()),
      { defer: true },
    ),
  )
  const show = (view: CommandView) => {
    setState({ view, project: undefined })
    setSearch({ view: view === "board" ? undefined : view, run: undefined }, { replace: true })
  }
  // Mission control is the newest thread in the thread view; a board focused on one Project stays here.
  createEffect(() => {
    if (state.view !== "board" || state.project || search.thread) return
    const latest = centre.latest()
    if (latest) navigate(sessionHref(server.key, latest.id), { replace: true })
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
            <CommandViews value={state.view} waiting={queue().length} onChange={show} />
          </>
        }
      />
      <div class="@container flex min-h-0 flex-1 flex-col px-3 pb-3">
        <Switch>
          <Match when={state.view === "workflows"}>
            <Workflows
              ctrl={ctrl}
              started={() => show("board")}
              run={state.run}
              selectRun={(run) => setState("run", run)}
              open={open}
              showProject={(project) => {
                setState({ view: "board", project })
                setSearch({ view: undefined, run: undefined }, { replace: true })
              }}
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
