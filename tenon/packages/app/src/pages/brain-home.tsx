import { useNavigate } from "@solidjs/router"
import { Icon } from "@tenon/ui/v2/icon"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { Reveal, RevealShow } from "@tenon/ui/v2/reveal"
import { PathTooltip, TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { createFreshItems } from "@/utils/fresh-items"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useDrafts } from "@/context/drafts"
import { useCommand } from "@/context/command"
import { useDialog } from "@tenon/ui/context/dialog"
import { DialogHarnessSetup } from "@/components/settings-v2/harness-setup"
import { PageEmpty, PageFrame, PageSection, pageRowClass } from "@/components/page"
import { eventCoversDay, localDateKey } from "@/features/second-brain/calendar-domain"
import { createCalendarResource } from "@/features/second-brain/calendar-cache"
import { TaskCheck } from "@/features/second-brain/calendar-peek"
import { createTaskActions } from "@/features/second-brain/task-actions"
import { type CalendarEvent, type PlannerTask } from "@/features/second-brain/client"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { agentRunStatus } from "@/pages/activity-runs"
import { Harness } from "@tenon/schema/harness"
import { harnessAssistantDirectory, listHarnessSetup } from "@/utils/server"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { ComposerModelPill, createComposerHarness } from "@/components/prompt-input/composer-harness"
import { PromptBranchPicker } from "@/components/prompt-workspace-selector"
import { Greeting } from "@/pages/new-session/greeting"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { useServerSync } from "@/context/server-sync"
import { getFilename } from "@tenon/core/util/path"
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
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const drafts = useDrafts()
  const command = useCommand()
  const tenonHome = createHomeController()
  const tenonSessions = createHomeSessionsController(tenonHome)
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  // The sidebar workspace switcher owns this choice; the page only follows it.
  const directory = () => layout.home.workspace() ?? ""
  // Home starts on the harness chosen in Settings › Harnesses.
  const harness = createComposerHarness({
    scope: "home",
    directory,
    initial: () => {
      const choice = settings.harnesses.newThreadChoice()
      return choice && { harnessID: choice.harnessID, model: choice.model as Harness.ModelSelection | undefined }
    },
  })

  // First run: offer the built-in agent setup once, unless every built-in agent is already installed and signed in.
  // It runs in the server's non-project assistant folder, so a new user needs no workspace for it.
  const dialog = useDialog()
  createEffect(() => {
    if (!settings.ready() || settings.harnesses.setupPrompted()) return
    settings.harnesses.setSetupPrompted()
    const harnessServer = { server: serverSDK().server.http, fetch: platform.fetch }
    void listHarnessSetup(harnessServer, "")
      .then(async (statuses) => {
        if (statuses.every((item) => item.installed && item.auth !== "signed-out")) return
        const target = await harnessAssistantDirectory(harnessServer, "")
        void dialog.show(() => <DialogHarnessSetup directory={target} />)
      })
      .catch(() => undefined)
  })

  const projects = useBrainProjects()
  // Cached per workspace, so Today paints at launch and a background sync updates it in place.
  const calendar = createCalendarResource(() => directory() || undefined, client)
  // A window left open overnight moves to the new day when it next takes focus.
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
    // A failure shows inline below instead.
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
      .filter(
        (record) =>
          !!agentRunStatus(data.session_status[record.session.id], data.permission[record.session.id]?.length ?? 0),
      )
  })

  // Recent threads that aren't already under Running work, from every open folder.
  const resumeSessions = createMemo(() => {
    const running = new Set(runningSessions().map((record) => record.session.id))
    return tenonSessions.data
      .records()
      .filter((record) => !record.session.parentID && !running.has(record.session.id))
      .slice(0, RESUME_LIMIT)
  })

  const composer = createComposerController({
    persist: "home",
    // The draft page sends the prompt as soon as its composer is ready.
    send: async (prompt) => {
      await drafts.create(
        { server: server.key, directory: directory() },
        prompt,
        harness.builtInModel(),
        harness.harnessID(),
        { send: true, harnessModel: harness.harnessModel() },
      )
      return true
    },
    disabled: () => !directory(),
    blocked: harness.waiting,
  })

  return (
    <PageFrame labelledBy="brain-home-title">
      <h1 id="brain-home-title" class="sr-only">
        {language.t("secondBrain.home.title")}
      </h1>
      <div class="flex h-14 items-center gap-2 px-4">
        <span class="flex-1" />
        <TooltipV2
          value={
            <>
              {language.t("secondBrain.home.openWorkspace")}
              <KeybindV2 keys={command.keybindParts("project.open")} variant="neutral" />
            </>
          }
          placement="bottom"
        >
          <IconButtonV2
            variant="ghost"
            size="large"
            class="!size-9"
            aria-label={language.t("secondBrain.home.openWorkspace")}
            icon={<Icon name="folder-add-left" />}
            onClick={() => command.trigger("project.open")}
          />
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
        {/* The same new-thread layout as a draft: the greeting, then a composer whose top row says where the
            thread runs and whose one pill picks the harness, model, reasoning and speed. It scales with the window. */}
        <div class="@container">
          <div
            class={`mx-auto flex ${NEW_SESSION_CONTENT_WIDTH} flex-col gap-[clamp(24px,4vh,48px)] px-6 pb-12 pt-[12vh]`}
          >
            <Greeting />
            <ComposerBox
              size="large"
              controller={composer}
              label={language.t("secondBrain.home.ask")}
              placeholder={language.t("secondBrain.home.askPlaceholder")}
              sendLabel={language.t("secondBrain.home.start")}
              header={
                <div class="flex h-10 min-w-0 items-center gap-0.5 border-b border-v2-border-border-muted pl-2.5 pr-2">
                  <PathTooltip
                    placement="top"
                    class="min-w-0 shrink"
                    name={getFilename(directory())}
                    path={directory()}
                  >
                    <span class="flex h-8 min-w-0 shrink items-center gap-1.5 px-2 text-[13px] leading-5 text-v2-text-text-muted">
                      <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                      <span class="min-w-0 truncate text-v2-text-text-base [font-weight:500]">
                        {getFilename(directory())}
                      </span>
                    </span>
                  </PathTooltip>
                  <Icon name="chevron-down" size="small" class="shrink-0 -rotate-90 text-v2-icon-icon-muted" />
                  <PromptBranchPicker directory={directory()} branch={serverSync().child(directory())[0].vcs?.branch} />
                </div>
              }
              controls={<ComposerModelPill harness={harness} />}
            />

            <RevealShow when={!!(projects.failed() || calendar.error())}>
              {() => (
                <div class="flex flex-wrap items-center justify-center gap-2">
                  <p role="alert" class="text-[12px] text-v2-text-text-critical">
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
                <h2 id="brain-home-first-run" class="text-[15px] text-v2-text-text-base [font-weight:600]">
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

            {/* Runs start and stop live: the section opens and closes, and a run that starts later enters.
              The column gap moves inside the reveal (-mt-8 / pt-8), so a closed section takes no room. */}
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
                            <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:400]">
                              {record.session.title}
                            </span>
                            <Show when={approvals() > 0}>
                              <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-2 py-0.5 text-[11px] text-v2-state-fg-warning">
                                {language.t("secondBrain.activity.approvals", { count: approvals() })}
                              </span>
                            </Show>
                            <span class="max-w-40 shrink-0 truncate text-[12px] text-v2-text-text-faint">
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

            <Show when={todayItems().length > 0}>
              <PageSection
                id="brain-home-today"
                title={language.t("secondBrain.home.today")}
                onTitle={() => navigate("/calendar")}
              >
                <ul class="flex flex-col">
                  <For each={todayItems()}>
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
                            <span class="flex w-12 shrink-0 justify-center">
                              <Show when={item.kind === "event"}>
                                <span class="text-[12px] tabular-nums text-v2-text-text-muted">
                                  {value.start || language.t("secondBrain.home.kind.event")}
                                </span>
                              </Show>
                            </span>
                            <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:400]">
                              {value.title}
                            </span>
                            <Show when={overdue}>
                              <span class="shrink-0 text-[12px] text-v2-state-fg-danger">
                                {language.t("secondBrain.tasks.overdue")}
                              </span>
                            </Show>
                            <Show when={project()}>
                              {(name) => (
                                <span class="max-w-40 shrink-0 truncate text-[12px] text-v2-text-text-faint">
                                  {name()}
                                </span>
                              )}
                            </Show>
                          </button>
                          {/* Beside the row's button, since a checkbox can't sit inside one. */}
                          <Show when={item.kind === "task" && item.value}>
                            {(task) => (
                              <span class="absolute inset-y-0 left-3 flex w-12 items-center justify-center">
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
                        class={`${pageRowClass} text-[13px] text-v2-text-text-muted`}
                        onClick={() => navigate("/calendar")}
                      >
                        {language.t("secondBrain.home.more", { count: allToday().length - TODAY_LIMIT })}
                      </button>
                    </li>
                  </Show>
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
                          <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:400]">
                            {sessionTitle(record.session.title) || record.session.id}
                          </span>
                          <span class="max-w-40 shrink-0 truncate text-[12px] text-v2-text-text-faint">
                            {record.projectName}
                          </span>
                          <span class="shrink-0 text-[12px] text-v2-text-text-faint">
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
                          <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:400]">
                            {project.name}
                          </span>
                          <span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-v2-background-bg-layer-03">
                            <span
                              class="block h-full rounded-full bg-v2-background-bg-accent transition-[width] duration-medium ease-standard motion-reduce:transition-none"
                              style={{ width: `${project.progressPercent}%` }}
                            />
                          </span>
                          <span class="w-9 shrink-0 text-right text-[12px] tabular-nums text-v2-text-text-faint">
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
