import { useNavigate } from "@solidjs/router"
import { Meter } from "@/components/meter"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { Reveal, RevealShow } from "@tenon/ui/v2/reveal"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { createFreshItems } from "@/utils/fresh-items"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useCommand } from "@/context/command"
import { useDialog } from "@tenon/ui/context/dialog"
import { PageEmpty, PageFrame, PageSection, pageRowClass } from "@/components/page"
import { eventCoversDay, localDateKey } from "@/features/second-brain/calendar-domain"
import { createCalendarResource } from "@/features/second-brain/calendar-cache"
import { TaskCheck } from "@/features/second-brain/calendar-peek"
import { createTaskActions } from "@/features/second-brain/task-actions"
import { type CalendarEvent, type PlannerTask } from "@/features/second-brain/client"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { createHomeController } from "@/pages/home/home-controller"
import { HomeComposer } from "@/pages/home/home-composer"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { agentRunStatus, needsYou } from "@/pages/activity-runs"
import { harnessAssistantDirectory, listHarnessSetup, listHarnessUsage, rememberedHarnesses } from "@/utils/server"
import { fullestWindow } from "@/components/harness-usage"
import { HarnessIcon } from "@/components/harness-icon"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { useSettings } from "@/context/settings"
import { settled } from "@/utils/resource"
import { sessionTitle } from "@/utils/session-title"
import { getRelativeTime } from "@/utils/time"

const TODAY_LIMIT = 8
const RESUME_LIMIT = 5

type TodayItem = { kind: "event"; value: CalendarEvent } | { kind: "task"; value: PlannerTask; overdue: boolean }

export default function BrainHomePage() {
  const language = useLanguage()
  const settings = useSettings()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const command = useCommand()
  const tenonHome = createHomeController()
  const tenonSessions = createHomeSessionsController(tenonHome)
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  const directory = () => layout.home.workspace() ?? ""

  const [usageTick, setUsageTick] = createSignal(0)
  const usageTimer = setInterval(() => setUsageTick((value) => value + 1), 60_000)
  onCleanup(() => clearInterval(usageTimer))
  let lastUsage: Awaited<ReturnType<typeof listHarnessUsage>> = []
  const [usage] = createResource(
    () => (directory() ? { directory: directory(), tick: usageTick() } : undefined),
    (input) =>
      listHarnessUsage({ server: serverSDK().server.http, fetch: platform.fetch }, input.directory).then(
        (reports) => (lastUsage = reports),
        () => lastUsage,
      ),
    { initialValue: [] },
  )
  const usageReports = createMemo(() =>
    (usage.latest ?? []).filter((report) => report.status === "available" && report.windows.length > 0),
  )
  const harnessName = (id: string) =>
    rememberedHarnesses(serverSDK().server.http.url, directory())?.find((item) => item.id === id)?.name ?? id

  const dialog = useDialog()
  createEffect(() => {
    if (!settings.ready() || settings.harnesses.setupPrompted()) return
    settings.harnesses.setSetupPrompted()
    const harnessServer = { server: serverSDK().server.http, fetch: platform.fetch }
    void listHarnessSetup(harnessServer, "")
      .then(async (statuses) => {
        if (statuses.every((item) => item.installed && item.auth !== "signed-out")) return
        const target = await harnessAssistantDirectory(harnessServer, "")
        const { DialogHarnessSetup } = await import("@/components/settings-v2/harness-setup")
        void dialog.show(() => <DialogHarnessSetup directory={target} />)
      })
      .catch(() => undefined)
  })

  const projects = useBrainProjects()
  const calendar = createCalendarResource(() => directory() || undefined, client)
  const [today, setToday] = createSignal(localDateKey(new Date()))
  makeEventListener(window, "focus", () => setToday(localDateKey(new Date())))
  const [google, googleActions] = createResource(async () => platform.googleCalendar?.status())
  const tasks = createTaskActions({
    directory,
    client,
    snapshot: calendar.snapshot,
    mutate: calendar.mutate,
    connection: () => settled(google),
    refreshConnection: () => googleActions.refetch(),
  })
  const activeProjects = createMemo(() =>
    (projects.list() ?? [])
      .filter((project) => project.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5),
  )
  const projectNames = createMemo(() => new Map((projects.list() ?? []).map((project) => [project.id, project.name])))
  const allToday = createMemo<TodayItem[]>(() => {
    const snapshot = calendar.snapshot()
    const day = today()
    const events = (snapshot?.events ?? [])
      .filter((event) => eventCoversDay(event, day))
      .map((value): TodayItem => ({ kind: "event", value }))
    const open = (snapshot?.tasks ?? [])
      .filter(
        (task) =>
          !task.completedAt &&
          (task.scheduledDate === day || task.dueDate === day || (!!task.dueDate && task.dueDate < day)),
      )
      .map((value): TodayItem => ({ kind: "task", value, overdue: !!value.dueDate && value.dueDate < day }))
    return [...events, ...open].sort((left, right) => {
      const leftTime = left.kind === "event" ? (left.value.start ?? "") : (left.value.start ?? "")
      const rightTime = right.kind === "event" ? (right.value.start ?? "") : (right.value.start ?? "")
      return leftTime.localeCompare(rightTime) || left.value.title.localeCompare(right.value.title)
    })
  })
  const todayItems = createMemo(() => allToday().slice(0, TODAY_LIMIT))
  const freshRun = createFreshItems()
  const runningSessions = createMemo(() => {
    const data = tenonHome.server.focusedSync().session.data
    return tenonSessions.data
      .records()
      .filter((record) => !!agentRunStatus(data.session_status[record.session.id], needsYou(data, record.session.id)))
  })

  const resumeSessions = createMemo(() => {
    const running = new Set(runningSessions().map((record) => record.session.id))
    return tenonSessions.data
      .records()
      .filter((record) => !record.session.parentID && !running.has(record.session.id))
      .slice(0, RESUME_LIMIT)
  })

  return (
    <PageFrame labelledBy="brain-home-title">
      <h1 id="brain-home-title" class="sr-only">
        {language.t("secondBrain.home.title")}
      </h1>
      <div class="flex h-14 items-center gap-2 px-4">
        <span class="flex-1" />
        <TooltipV2
          value={<KeybindV2 keys={command.keybindParts("project.open")} variant="neutral" />}
          placement="bottom"
        >
          <ButtonV2 variant="neutral" icon="folder-open" onClick={() => command.trigger("project.open")}>
            {language.t("secondBrain.home.openWorkspace")}
          </ButtonV2>
        </TooltipV2>
      </div>

      <Show
        when={directory()}
        fallback={
          <PageEmpty
            title={language.t("secondBrain.state.noWorkspace.title")}
            action={
              <ButtonV2 variant="contrast" onClick={() => command.trigger("project.open")}>
                {language.t("secondBrain.home.openWorkspace")}
              </ButtonV2>
            }
          >
            {language.t("secondBrain.state.noWorkspace.body")}
          </PageEmpty>
        }
      >
        <div class="@container">
          <div
            class={`mx-auto flex ${NEW_SESSION_CONTENT_WIDTH} flex-col gap-[clamp(24px,4vh,48px)] px-6 pb-12 pt-[12vh]`}
          >
            <HomeComposer directory={directory()} />

            <RevealShow when={!!(projects.failed() || calendar.error())}>
              {() => (
                <div class="flex flex-wrap items-center justify-center gap-2">
                  <p role="alert" class="type-meta text-v2-text-text-critical">
                    {language.t("secondBrain.error.request")}
                  </p>
                  <ButtonV2
                    size="small"
                    variant="outline"
                    onClick={() => {
                      if (projects.failed()) projects.retry()
                      if (calendar.error()) void calendar.refetch()
                    }}
                  >
                    {language.t("secondBrain.error.retry")}
                  </ButtonV2>
                </div>
              )}
            </RevealShow>

            <Show when={projects.list()?.length === 0}>
              <section class="flex flex-col items-center gap-3 text-center" aria-labelledby="brain-home-first-run">
                <h2 id="brain-home-first-run" class="type-toolbar-title text-v2-text-text-base">
                  {language.t("secondBrain.home.firstRun.title")}
                </h2>
                <div class="flex flex-wrap justify-center gap-2">
                  <ButtonV2 variant="contrast" onClick={() => navigate("/projects?new=1")}>
                    {language.t("secondBrain.home.firstRun.project")}
                  </ButtonV2>
                  <ButtonV2 variant="outline" onClick={() => command.trigger("project.open")}>
                    {language.t("secondBrain.home.firstRun.folder")}
                  </ButtonV2>
                  <Show when={platform.googleCalendar}>
                    <ButtonV2 variant="ghost" onClick={() => navigate("/calendar?google=connect")}>
                      {language.t("secondBrain.home.firstRun.google")}
                    </ButtonV2>
                  </Show>
                </div>
              </section>
            </Show>

            <Reveal open={runningSessions().length > 0} class="-mt-8">
              <PageSection
                class="pt-8"
                id="brain-home-running"
                title={language.t("secondBrain.home.running")}
                onTitle={() => navigate("/command")}
              >
                <ul class="flex flex-col">
                  <For each={runningSessions()}>
                    {(record) => {
                      const approvals = () =>
                        tenonHome.server.focusedSync().session.data.permission[record.session.id]?.length ?? 0
                      const enter = freshRun(record.session.id)
                      return (
                        <li class={enter ? "animate-enter" : undefined}>
                          <button
                            type="button"
                            class={pageRowClass}
                            onClick={() => tenonSessions.session.open(record.session)}
                          >
                            <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse" />
                            <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                              {sessionTitle(record.session.title) || record.session.id}
                            </span>
                            <Show when={approvals() > 0}>
                              <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-2 py-0.5 type-caption text-v2-state-fg-warning">
                                {language.t("secondBrain.activity.approvals", { count: approvals() })}
                              </span>
                            </Show>
                            <span class="max-w-40 shrink-0 truncate type-meta text-v2-text-text-muted">
                              {record.projectName}
                            </span>
                          </button>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </PageSection>
            </Reveal>

            <Show when={calendar.snapshot()}>
              <PageSection
                id="brain-home-today"
                title={language.t("secondBrain.home.today")}
                onTitle={() => navigate("/calendar")}
              >
                <ul class="flex flex-col">
                  <For
                    each={todayItems()}
                    fallback={
                      <li>
                        <button
                          type="button"
                          class={`${pageRowClass} type-control text-v2-text-text-muted`}
                          onClick={() => navigate("/calendar")}
                        >
                          {language.t("secondBrain.home.nothingToday")}
                        </button>
                      </li>
                    }
                  >
                    {(item) => {
                      const value = item.value
                      const overdue = item.kind === "task" && item.overdue
                      const project = () => (value.projectId ? projectNames().get(value.projectId) : undefined)
                      return (
                        <li class="relative">
                          <button
                            type="button"
                            class={pageRowClass}
                            onClick={() =>
                              navigate(
                                `/calendar?${item.kind === "task" ? "view=tasks&task" : "event"}=${encodeURIComponent(item.value.id)}`,
                              )
                            }
                          >
                            <span class="flex w-12 shrink-0">
                              <Show when={item.kind === "event"}>
                                <span class="type-meta tabular-nums text-v2-text-text-muted">
                                  {value.start || language.t("secondBrain.home.allDay")}
                                </span>
                              </Show>
                            </span>
                            <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                              {value.title}
                            </span>
                            <Show when={overdue}>
                              <span class="shrink-0 type-meta text-v2-state-fg-danger">
                                {language.t("secondBrain.tasks.overdue")}
                              </span>
                            </Show>
                            <Show when={project()}>
                              {(name) => (
                                <span class="max-w-40 shrink-0 truncate type-meta text-v2-text-text-muted">
                                  {name()}
                                </span>
                              )}
                            </Show>
                          </button>
                          <Show when={item.kind === "task" && item.value}>
                            {(task) => (
                              <span class="absolute inset-y-0 left-3 flex w-12 items-center">
                                <TaskCheck small task={task()} onToggle={tasks.toggle} />
                              </span>
                            )}
                          </Show>
                        </li>
                      )
                    }}
                  </For>
                  <Show when={allToday().length > TODAY_LIMIT}>
                    <li>
                      <button
                        type="button"
                        class={`${pageRowClass} type-control text-v2-text-text-muted`}
                        onClick={() => navigate("/calendar")}
                      >
                        {language.t("secondBrain.home.more", { count: allToday().length - TODAY_LIMIT })}
                      </button>
                    </li>
                  </Show>
                </ul>
              </PageSection>
            </Show>

            <Show when={usageReports().length > 0}>
              <PageSection id="brain-home-usage" title={language.t("secondBrain.home.usage")}>
                <ul class="flex flex-col">
                  <For each={usageReports()}>
                    {(report) => {
                      const window = () => fullestWindow(report)
                      return (
                        <Show when={window()}>
                          {(fullest) => (
                            <li class="flex min-w-0 items-center gap-3 px-3 py-2">
                              <span class="flex w-36 shrink-0 items-center gap-2 type-row-title text-v2-text-text-base">
                                <HarnessIcon
                                  instance={{ id: report.instanceID, name: harnessName(report.instanceID) }}
                                />
                                <span class="min-w-0 truncate">{harnessName(report.instanceID)}</span>
                              </span>
                              <span class="w-16 shrink-0 truncate type-meta text-v2-text-text-muted">
                                {fullest().label}
                              </span>
                              <Meter
                                class="flex-1"
                                value={fullest().usedPercent}
                                label={`${harnessName(report.instanceID)} ${fullest().label}`}
                              />
                              <span class="w-10 shrink-0 text-right tabular-nums type-meta text-v2-text-text-muted">
                                {`${Math.round(fullest().usedPercent)}%`}
                              </span>
                            </li>
                          )}
                        </Show>
                      )
                    }}
                  </For>
                </ul>
              </PageSection>
            </Show>

            <Show when={resumeSessions().length > 0}>
              <PageSection id="brain-home-resume" title={language.t("secondBrain.home.resume")}>
                <ul class="flex flex-col">
                  <For each={resumeSessions()}>
                    {(record) => (
                      <li>
                        <button
                          type="button"
                          class={pageRowClass}
                          onClick={() => tenonSessions.session.open(record.session)}
                        >
                          <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                            {sessionTitle(record.session.title) || record.session.id}
                          </span>
                          <span class="max-w-40 shrink-0 truncate type-meta text-v2-text-text-muted">
                            {record.projectName}
                          </span>
                          <span class="shrink-0 type-meta text-v2-text-text-muted">
                            {getRelativeTime(new Date(record.session.time.updated).toISOString(), language.t)}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </PageSection>
            </Show>

            <Show when={activeProjects().length > 0}>
              <PageSection
                id="brain-home-projects"
                title={language.t("secondBrain.home.projects")}
                onTitle={() => navigate("/projects")}
              >
                <ul class="flex flex-col">
                  <For each={activeProjects()}>
                    {(project) => (
                      <li>
                        <button
                          type="button"
                          class={pageRowClass}
                          onClick={() => navigate(`/projects?project=${encodeURIComponent(project.id)}`)}
                        >
                          <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                            {project.name}
                          </span>
                          <Meter class="w-16 shrink-0" value={project.progressPercent} />
                          <span class="w-9 shrink-0 text-right type-meta tabular-nums text-v2-text-text-muted">
                            {project.progressPercent}%
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </PageSection>
            </Show>
          </div>
        </div>
      </Show>
    </PageFrame>
  )
}
