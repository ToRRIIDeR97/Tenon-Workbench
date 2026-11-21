import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, Match, on, onMount, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { PageFrame, PageHeader } from "@/components/page"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { AgentHands, createWaitingQueue } from "@/features/command-centre/agent-hands-view"
import { useCommandCentre } from "@/features/command-centre/command-centre"
import { CommandViews, type CommandView } from "@/features/command-centre/command-thread-chrome"
import { CommandHub } from "@/features/command-centre/hub-view"
import { createMissionThreads } from "@/features/command-centre/mission-board-view"
import { commandBackState } from "@/features/command-centre/thread-back"
import { Workflows } from "@/features/command-centre/workflows-view"
import { sessionHref } from "@/utils/session-route"

/**
 * The Command Centre. The header switches between three views and links to Routines:
 * - Hub: what the Command Centre runs on its own, what needs you, and a card per Project; a card opens the Project's
 *   crew (`?project=<id>`). Chat comes second, in the composer at the foot of the hub.
 * - Waiting on you: the queue of approvals and questions, the Projects' permission modes, and beside them what the
 *   agent did on the user's behalf today.
 * - Workflows: the saved workflows and runs beside the selected workflow's editor or run.
 * A Command Centre thread opens in the thread view, like a Project thread but without review, files or terminal.
 * `/command?thread=<session id>` (older links, the strip's "Open full") opens that thread; `?view=waiting` or
 * `?view=workflows` (with `&run=<id>`) opens those views, which is how a Command Centre thread's header gets here;
 * `?project=<id>` opens a Project in the hub.
 */
export default function CommandCentrePage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const server = useServer()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  // The provider outlives this page, so catch up on what changed while it was closed.
  onMount(() => void centre.refetch())
  const [search, setSearch] = useSearchParams<{ thread?: string; view?: string; run?: string; project?: string }>()
  const initial = (): CommandView => (search.view === "waiting" || search.view === "workflows" ? search.view : "board")
  const [state, setState] = createStore({
    view: initial(),
    // The workflow run shown in the Workflows view, and the Project the board is asked to show.
    run: search.run as string | undefined,
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
    setState({ view })
    setSearch({ view: view === "board" ? undefined : view, run: undefined, project: undefined }, { replace: true })
  }
  // The open Project lives in the URL, so Back in the app returns from a thread to the Project it was opened from.
  const project = () => (state.view === "board" ? search.project : undefined)
  const selectProject = (id: string | undefined) => setSearch({ project: id })
  const projectName = () => ctrl.groups().projects.find((group) => String(group.project.id) === project())?.project.name
  // Back in the thread returns to this exact screen (the hub, a Project's crew, a view).
  const open = (sessionID: string) =>
    navigate(sessionHref(server.key, sessionID), { state: commandBackState(location.pathname + location.search) })
  const board = createMissionThreads(ctrl)
  const queue = createWaitingQueue(ctrl, board)
  createEffect(() => {
    if (search.thread) navigate(sessionHref(server.key, search.thread), { replace: true })
  })

  return (
    <PageFrame labelledBy="command-centre-title" scroll={false}>
      <PageHeader
        id="command-centre-title"
        title={projectName() ?? language.t("secondBrain.commandCentre.title")}
        back={
          projectName()
            ? { label: language.t("secondBrain.commandCentre.hub.back"), onClick: () => selectProject(undefined) }
            : undefined
        }
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
              showProject={(id) => {
                setState({ view: "board" })
                setSearch({ view: undefined, run: undefined, project: id }, { replace: true })
              }}
            />
          </Match>
          <Match when={state.view === "waiting"}>
            <AgentHands ctrl={ctrl} queue={queue()} open={open} />
          </Match>
          <Match when={true}>
            <CommandHub ctrl={ctrl} queue={queue()} open={open} project={project()} selectProject={selectProject} />
          </Match>
        </Switch>
      </div>
    </PageFrame>
  )
}
