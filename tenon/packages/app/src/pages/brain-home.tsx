import { useNavigate } from "@solidjs/router"
import { Icon } from "@tenon/ui/v2/icon"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { Reveal, RevealShow } from "@tenon/ui/v2/reveal"
import { PathTooltip, TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createEffect, createMemo, For, Show, Suspense } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
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
import { localDateKey } from "@/features/second-brain/calendar-domain"
import { createCalendarResource } from "@/features/second-brain/calendar-cache"
import { type CalendarEvent, type PlannerTask } from "@/features/second-brain/client"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { Harness } from "@tenon/schema/harness"
import {
  harnessAssistantDirectory,
  listHarnessSetup,
  listHarnessesRemembered,
  rememberedHarnesses,
} from "@/utils/server"
import type { PromptInputHarnessController } from "@/components/prompt-input/harness-controls"
import { PromptModelPill } from "@/components/prompt-input/model-pill"
import { PromptDictationButton } from "@/components/prompt-input/dictation-button"
import { HomeModelPill } from "@/pages/home/home-model-pill"
import type { PromptModel } from "@/context/prompt"
import { PromptBranchPicker } from "@/components/prompt-workspace-selector"
import { Greeting } from "@/pages/new-session/greeting"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { useServerSync } from "@/context/server-sync"
import { getFilename } from "@tenon/core/util/path"
import { MODEL_RETRIES, MODEL_RETRY_MS, defaultModel } from "@/components/prompt-input/harness-controller"
import { useSettings, withVisibleModels } from "@/context/settings"

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
  const [state, setState] = createStore({
    prompt: "",
    harnessInstanceID: Harness.OpenCode as Harness.InstanceID,
    harnessModel: undefined as Harness.ModelSelection | undefined,
    // The built-in agent's model and reasoning, from the folder's model selection.
    builtInModel: undefined as PromptModel | undefined,
    starting: false,
    // Set once the user picks a harness here, so a later settings load doesn't override it.
    picked: false,
  })
  // Home starts on the harness chosen in Settings › Harnesses. Settings load asynchronously on desktop.
  createEffect(() => {
    const choice = settings.harnesses.newThreadChoice()
    if (!choice || state.picked) return
    setState({
      harnessInstanceID: choice.harnessID as Harness.InstanceID,
      harnessModel: choice.model as Harness.ModelSelection | undefined,
    })
  })
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  // The sidebar workspace switcher owns this choice; the page only follows it.
  const directory = () => layout.home.workspace() ?? ""

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
  const harnessQuery = useQuery(() => ({
    queryKey: ["home", "harnesses", server.key, directory()],
    enabled: !!directory(),
    queryFn: () => listHarnessesRemembered({ server: serverSDK().server.http, fetch: platform.fetch }, directory()),
    // After the cached query is collected, the last good list keeps the picker usable while it reloads.
    placeholderData: () => rememberedHarnesses(serverSDK().server.http.url, directory()),
    staleTime: 30_000,
    refetchOnMount: true,
    // A check that fails before anything is remembered (the server still starting) is retried soon.
    retry: MODEL_RETRIES,
    retryDelay: MODEL_RETRY_MS,
    // The selected agent can answer before its models are listed; ask again until they arrive, as threads do.
    refetchInterval: (query) => {
      const selected = query.state.data?.find((item) => item.id === state.harnessInstanceID)
      const waiting =
        selected?.driver !== Harness.OpenCodeDriver && selected?.status === "available" && selected.models.length === 0
      return waiting && query.state.dataUpdateCount <= MODEL_RETRIES ? MODEL_RETRY_MS : false
    },
  }))
  // Models hidden in Settings never reach the picker or the default-model choice, as in the thread composer.
  // Reading `data` suspends, so callers outside the controls' Suspense boundary check `isPending` first.
  const harnesses = () =>
    harnessQuery.data?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    )
  const selectHarness = (instanceID: Harness.InstanceID) => {
    const next = harnesses()?.find((instance) => instance.id === instanceID)
    setState({ harnessInstanceID: instanceID, harnessModel: next ? defaultModel(next) : undefined, picked: true })
  }
  // Fall back to an available harness, and keep the model valid for the selected one.
  createEffect(() => {
    if (harnessQuery.isPending) return
    const available = harnesses()
    if (!available) return
    const current = available.find((instance) => instance.id === state.harnessInstanceID)
    if (current?.status !== "available") {
      // Only a confirmed check moves Home off its harness; a remembered list may be out of date.
      if (harnessQuery.isPlaceholderData) return
      const fallback = available.find((instance) => instance.status === "available")
      if (fallback) setState({ harnessInstanceID: fallback.id, harnessModel: defaultModel(fallback) })
      return
    }
    if (current.models.some((model) => model.id === state.harnessModel?.id)) return
    setState("harnessModel", defaultModel(current))
  })
  const harness: PromptInputHarnessController = {
    instances: harnesses,
    // Only the first load blocks the picker; a stale list stays usable while it refreshes.
    loading: () => harnessQuery.isPending,
    // Opening the picker refetches once stale; the app's queries don't refetch on window focus.
    revalidate: () => void (harnessQuery.isStale && harnessQuery.refetch()),
    current: () => state.harnessInstanceID,
    select: selectHarness,
    model: {
      current: () => state.harnessModel,
      set: (model) => setState("harnessModel", model),
    },
  }
  const today = localDateKey(new Date())
  const activeProjects = createMemo(() =>
    (projects.list() ?? [])
      .filter((project) => project.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5),
  )
  const projectNames = createMemo(() => new Map((projects.list() ?? []).map((project) => [project.id, project.name])))
  const todayItems = createMemo<TodayItem[]>(() => {
    // A failure shows inline below instead.
    const snapshot = calendar.snapshot()
    const events = (snapshot?.events ?? [])
      .filter((event) => event.date === today)
      .map((value): TodayItem => ({ kind: "event", value }))
    const tasks = (snapshot?.tasks ?? [])
      .filter(
        (task) =>
          !task.completedAt &&
          (task.scheduledDate === today || task.dueDate === today || (!!task.dueDate && task.dueDate < today)),
      )
      .map((value): TodayItem => ({ kind: "task", value, overdue: !!value.dueDate && value.dueDate < today }))
    return [...events, ...tasks]
      .sort((left, right) => {
        const leftTime = left.kind === "event" ? (left.value.start ?? "") : (left.value.start ?? "")
        const rightTime = right.kind === "event" ? (right.value.start ?? "") : (right.value.start ?? "")
        return leftTime.localeCompare(rightTime) || left.value.title.localeCompare(right.value.title)
      })
      .slice(0, 8)
  })
  const freshRun = createFreshItems()
  const runningSessions = createMemo(() => {
    const data = tenonHome.server.focusedSync().session.data
    return tenonSessions.data.records().filter((record) => {
      const status = data.session_status[record.session.id]
      return (status?.type ?? "idle") !== "idle" || (data.permission[record.session.id]?.length ?? 0) > 0
    })
  })

  // The built-in agent needs no check, so only another harness waits for the list. The thread page
  // sends once its own list has loaded, and keeps the prompt if the harness turns out unavailable.
  const builtIn = () =>
    (harnesses()?.find((item) => item.id === state.harnessInstanceID)?.driver ??
      (state.harnessInstanceID === Harness.OpenCode ? Harness.OpenCodeDriver : undefined)) === Harness.OpenCodeDriver
  const waitingForHarness = () => harnessQuery.isPending && state.harnessInstanceID !== Harness.OpenCode
  const startSession = async () => {
    const prompt = state.prompt.trim()
    if (!prompt || !directory() || state.starting || waitingForHarness()) return
    setState("starting", true)
    try {
      // The draft page sends the prompt as soon as its composer is ready.
      const model = builtIn() ? state.builtInModel : undefined
      await drafts.create({ server: server.key, directory: directory() }, prompt, model, state.harnessInstanceID, {
        send: true,
        harnessModel: state.harnessModel,
      })
    } finally {
      setState("starting", false)
    }
  }

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
            <form
              class="flex flex-col overflow-hidden rounded-[28px] bg-v2-background-bg-base shadow-[0_0_0_1px_var(--v2-border-border-base),0_8px_24px_-12px_rgb(0_0_0/0.18)] transition-shadow duration-short ease-standard focus-within:shadow-[0_0_0_1px_var(--v2-border-border-focus),0_8px_24px_-12px_rgb(0_0_0/0.18)] motion-reduce:transition-none"
              onSubmit={(event) => {
                event.preventDefault()
                void startSession()
              }}
            >
              <div class="flex h-10 min-w-0 items-center gap-0.5 border-b border-v2-border-border-muted pl-2.5 pr-2">
                <PathTooltip placement="top" class="min-w-0 shrink" name={getFilename(directory())} path={directory()}>
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
              <label class="sr-only" for="brain-home-prompt">
                {language.t("secondBrain.home.ask")}
              </label>
              <textarea
                id="brain-home-prompt"
                rows={2}
                class="max-h-60 min-h-[clamp(60px,9vh,112px)] w-full resize-none bg-transparent px-5 pt-4 text-[15px] leading-6 text-v2-text-text-base outline-none [field-sizing:content] placeholder:text-v2-text-text-faint"
                value={state.prompt}
                placeholder={language.t("secondBrain.home.askPlaceholder")}
                onInput={(event) => setState("prompt", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                  event.preventDefault()
                  void startSession()
                }}
              />
              <div class="flex min-w-0 items-center gap-1 pb-2 pl-2.5 pr-2">
                {/* The harness query suspends while it loads; this boundary keeps the rest of Home on screen. */}
                <Suspense
                  fallback={
                    <span class="flex h-8 items-center px-2 text-[12px] text-v2-text-text-faint">
                      {language.t("harness.checking")}
                    </span>
                  }
                >
                  <Show when={directory()} keyed fallback={<PromptModelPill harness={harness} builtIn={builtIn()} />}>
                    {(folder) => (
                      <HomeModelPill
                        directory={folder}
                        harness={harness}
                        builtIn={builtIn()}
                        onModel={(model) => setState("builtInModel", model)}
                      />
                    )}
                  </Show>
                </Suspense>
                <span class="flex-1" />
                {/* Dictation, as in thread composers; the transcript lands in this textarea. */}
                <Show when={platform.dictation}>
                  {(dictation) => (
                    <PromptDictationButton
                      dictation={dictation()}
                      restoreFocus={() => document.getElementById("brain-home-prompt")?.focus()}
                    />
                  )}
                </Show>
                <TooltipV2 placement="top" value={language.t("secondBrain.home.start")}>
                  <IconButtonV2
                    type="submit"
                    variant="contrast"
                    size="large"
                    class="!size-9"
                    aria-label={language.t("secondBrain.home.start")}
                    icon={<Icon name="arrow-up" />}
                    disabled={!state.prompt.trim() || state.starting || waitingForHarness()}
                  />
                </TooltipV2>
              </div>
            </form>

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
                        <li>
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
                              <Show
                                when={item.kind === "task"}
                                fallback={
                                  <span class="text-[12px] tabular-nums text-v2-text-text-muted">
                                    {value.start || language.t("secondBrain.home.kind.event")}
                                  </span>
                                }
                              >
                                <span
                                  classList={{
                                    "size-4 rounded-full border-[1.5px]": true,
                                    "border-v2-state-fg-danger": overdue,
                                    "border-v2-border-border-base": !overdue,
                                  }}
                                />
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
                        </li>
                      )
                    }}
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
