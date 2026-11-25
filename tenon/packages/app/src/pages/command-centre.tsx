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

export default function CommandCentrePage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const server = useServer()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  onMount(() => void centre.refetch())
  const [search, setSearch] = useSearchParams<{ thread?: string; view?: string; run?: string; project?: string }>()
  const initial = (): CommandView => (search.view === "waiting" || search.view === "workflows" ? search.view : "board")
  const [state, setState] = createStore({
    view: initial(),
    run: search.run as string | undefined,
  })
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
  const project = () => (state.view === "board" ? search.project : undefined)
  const selectProject = (id: string | undefined) => setSearch({ project: id })
  const projectName = () => ctrl.groups().projects.find((group) => String(group.project.id) === project())?.project.name
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
