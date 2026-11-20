import { Harness } from "@tenon/schema/harness"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { Presence } from "@tenon/ui/v2/presence"
import { ViewSwitch } from "@tenon/ui/v2/view-switch"
import { createEffect, createMemo, createResource, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { HarnessIcon } from "@/components/harness-icon"
import { useBrainProjects, type SidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import type { WaitingRequest } from "@/features/command-centre/agent-hands-view"
import { lastReplyText, useCommandCentre } from "@/features/command-centre/command-centre"
import {
  hubCards,
  modelLabel,
  projectCrew,
  sessionHarness,
  sessionOrigin,
  todoStep,
  type CrewAgent,
  type HubCard,
  type HubThread,
  type ModelCatalogue,
} from "@/features/command-centre/hub-model"
import { listCommandActions } from "@/features/second-brain/client"
import { lastUpdate } from "@/features/second-brain/sidebar-grouping"
import { flattenThreads } from "@/features/second-brain/sidebar-threads"
import { permissionSummary } from "@/pages/session/composer/permission-summary"
import { agentRunStatus, needsYou } from "@/pages/activity-runs"
import { rememberedHarnesses } from "@/utils/server"
import { sessionTitle } from "@/utils/session-title"
import { getRelativeTime } from "@/utils/time"

// Product names for harnesses the remembered list doesn't know yet; the built-in loop's name is translated.
const HARNESS_NAMES: Record<string, string> = {
  [Harness.OpenCodeAcp]: "OpenCode",
  [Harness.ClaudeCode]: "Claude Code",
  [Harness.Codex]: "Codex",
}
const NEEDS_SHOWN = 3
const CARD = "rounded-[16px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"

/**
 * The Command Centre's hub (Hub A): what the Command Centre runs on its own, what needs you (answered here), and a
 * card per Project. A card opens the Project (Project A): the Command Centre's plan for it, then a card per agent
 * working there (harness logo and model as its name, the thread title under it), Activity beside them, and an
 * agent's details in a panel. Chat comes second: the composer at the foot opens the latest Command Centre thread.
 */
export function CommandHub(props: {
  ctrl: SidebarController
  queue: WaitingRequest[]
  open: (sessionID: string) => void
  project?: string
  selectProject: (id: string | undefined) => void
}) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const centre = useCommandCentre()
  const projects = useBrainProjects()
  const [state, setState] = createStore({
    agent: undefined as string | undefined,
    sheet: false,
    text: "",
    answered: {} as Record<string, true>,
    busy: undefined as string | undefined,
    failed: undefined as string | undefined,
  })

  const workspace = () => layout.home.workspace() ?? undefined
  const catalogue = createMemo(() => {
    const list = rememberedHarnesses(serverSDK().server.http.url, workspace() ?? "") ?? []
    return Object.fromEntries(list.map((instance) => [instance.id, instance as ModelCatalogue])) as Record<
      string,
      ModelCatalogue | undefined
    >
  })
  const harnessName = (id: string) =>
    rememberedHarnesses(serverSDK().server.http.url, workspace() ?? "")?.find((instance) => instance.id === id)?.name ??
    (id === Harness.OpenCode ? language.t("harness.settings.defaults.builtIn") : HARNESS_NAMES[id]) ??
    id
  const logo = (id: string, size = "size-4") => <HarnessIcon instance={{ id, name: harnessName(id) }} class={size} />

  // Every Project's root threads as the hub reads them, from the sidebar's lists and the synced run state.
  const threads = createMemo(() => {
    const data = serverSync().session.data
    const untitled = language.t("secondBrain.commandCentre.threads.untitled")
    return Object.fromEntries(
      props.ctrl.groups().projects.map((group) => [
        String(group.project.id),
        group.threads.map((node): HubThread & { directory: string } => {
          const session = node.session
          const who = sessionHarness(session, Harness.OpenCode)
          const subtree = props.ctrl.subtreeState(node)
          const waited = flattenThreads([node]).reduce((sum, item) => sum + needsYou(data, item.id), 0)
          const waiting = waited > 0 ? waited : subtree === "approval" ? 1 : 0
          const running = agentRunStatus(data.session_status[session.id], 0) === "running" || subtree === "running"
          return {
            id: session.id,
            title: sessionTitle(session.title) || untitled,
            harness: who.harness,
            model: who.model,
            updated: lastUpdate(session),
            state: waiting > 0 ? "needs" : running ? "running" : "idle",
            waiting,
            origin: sessionOrigin(session),
            todos: data.todo[session.id],
            directory: session.directory,
          }
        }),
      ]),
    )
  })
  const records = createMemo(() => new Map((projects.list() ?? []).map((record) => [record.id, record] as const)))
  const lead = () => centre.latest()
  const cards = createMemo(() =>
    hubCards({
      projects: props.ctrl.groups().projects.map((group) => {
        const record = records().get(String(group.project.id))
        return {
          id: String(group.project.id),
          name: group.project.name,
          outcome: record?.outcome ?? "",
          status: record?.status ?? "active",
          progressPercent: record?.progressPercent ?? 0,
          nextMilestone: record?.nextMilestone,
        }
      }),
      threads: threads(),
      commandCentreHarness: lead() ? sessionHarness(lead()!.session, Harness.OpenCode).harness : undefined,
    }),
  )
  // Cards and agents are listed by id and looked up, so an update rewrites a card in place instead of remounting it
  // (which would replay its entrance).
  const sameIDs = (left: string[], right: string[]) =>
    left.length === right.length && left.every((id, index) => id === right[index])
  const cardIDs = createMemo(() => cards().map((item) => item.id), [], { equals: sameIDs })
  const cardByID = createMemo(() => new Map(cards().map((item) => [item.id, item] as const)))
  const card = () => cardByID().get(props.project ?? "")
  const crew = createMemo(() =>
    projectCrew({
      now: Date.now(),
      threads: threads()[props.project ?? ""] ?? [],
      commandCentre: centre.threads().map((thread) => ({
        id: thread.id,
        title: centre.label(thread) || thread.title,
        ...sessionHarness(thread.session, Harness.OpenCode),
      })),
      instances: catalogue(),
    }),
  )
  const agentIDs = createMemo(() => crew().agents.map((agent) => agent.id), [], { equals: sameIDs })
  const agentByID = createMemo(() => new Map(crew().agents.map((agent) => [agent.id, agent] as const)))
  const directoryOf = (id: string) =>
    (threads()[props.project ?? ""] ?? []).find((thread) => thread.id === id)?.directory

  // Steps come from each thread's checklist, loaded once per thread on screen.
  const asked = new Set<string>()
  createEffect(() => {
    const ids = [...crew().agents.map((agent) => agent.id), ...(crew().lead ? [crew().lead!.id] : [])]
    for (const id of ids) {
      if (asked.has(id)) continue
      asked.add(id)
      void serverSync().session.todo(id)
    }
  })
  // The opened agent's latest reply needs its messages.
  createEffect(
    on(
      () => state.agent,
      (id) => id && void serverSync().session.sync(id),
    ),
  )
  createEffect(
    on(
      () => props.project,
      () => setState("agent", undefined),
      { defer: true },
    ),
  )
  // Esc closes the agent panel; the sheet takes Esc first while it is open.
  createEffect(() => {
    if (!state.agent) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || state.sheet) return
      setState("agent", undefined)
    }
    window.addEventListener("keydown", close)
    onCleanup(() => window.removeEventListener("keydown", close))
  })

  const [actions] = createResource(workspace, (target) =>
    listCommandActions(
      { server: serverSDK().server, fetch: platform.fetch, target: { directory: target } },
      new Date().setHours(0, 0, 0, 0),
    ).catch(() => []),
  )

  const waiting = createMemo(() => props.queue.filter((entry) => !state.answered[entry.item.requestID]))
  const answer = (entry: WaitingRequest, reply: "once" | "reject") => {
    if (state.busy) return
    setState({ busy: entry.item.requestID, failed: undefined })
    void serverSDK()
      .ensureDirSdkContext(entry.root.directory)
      .api.permission.reply({ sessionID: entry.item.sessionID, requestID: entry.item.requestID, reply })
      .then(
        () => setState({ busy: undefined, answered: { ...state.answered, [entry.item.requestID]: true } }),
        () => setState({ busy: undefined, failed: entry.item.requestID }),
      )
  }
  const stop = (id: string) => {
    const directory = directoryOf(id)
    if (directory) void serverSDK().ensureDirSdkContext(directory).api.session.interrupt({ sessionID: id })
  }
  const send = () => {
    const text = state.text.trim()
    if (!text || centre.sending()) return
    const scoped = card()
      ? `${language.t("secondBrain.commandCentre.hub.about", { project: card()!.name })}\n\n${text}`
      : text
    void centre.send(scoped).then((id) => id && setState("text", ""))
  }
  const ago = (ms: number) => getRelativeTime(new Date(ms).toISOString(), language.t)
  const totals = createMemo(() => ({
    projects: cards().filter((item) => item.working + item.needs > 0).length,
    agents: cards().reduce((sum, item) => sum + item.working, 0),
  }))

  const Dot = () => (
    <span
      class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
      role="img"
      aria-label={language.t("secondBrain.sidebar.running")}
    />
  )
  const StateLabel = (label: { state: HubCard["state"] }) => (
    <Switch>
      <Match when={label.state === "needs"}>
        <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-2.5 py-0.5 type-caption text-v2-state-fg-warning">
          {language.t("secondBrain.commandCentre.hub.state.needs")}
        </span>
      </Match>
      <Match when={label.state === "running"}>
        <span class="flex shrink-0 items-center gap-1.5 type-caption text-v2-text-text-muted">
          <Dot />
          {language.t("secondBrain.commandCentre.hub.state.running")}
        </span>
      </Match>
      <Match when={true}>
        <span class="shrink-0 type-caption text-v2-text-text-muted">
          {language.t(
            label.state === "paused"
              ? "secondBrain.commandCentre.hub.state.paused"
              : "secondBrain.commandCentre.hub.state.idle",
          )}
        </span>
      </Match>
    </Switch>
  )
  const Bar = (bar: { value: number; thin?: boolean }) => (
    <div
      class="overflow-hidden rounded-full bg-v2-background-bg-layer-02"
      classList={{ "h-1": !bar.thin, "h-0.5": bar.thin }}
    >
      <div
        class="h-full rounded-full bg-v2-background-bg-accent transition-[width] duration-medium ease-emphasized-decelerate motion-reduce:transition-none"
        style={{ width: `${Math.max(0, Math.min(100, bar.value))}%` }}
      />
    </div>
  )
  // Who: the harness logo, then the model as the agent's name; under it the line the caller passes.
  const Who = (who: { harness: string; name: string; sub: string }) => (
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-v2-background-bg-layer-02">
        {logo(who.harness)}
      </span>
      <div class="flex min-w-0 flex-col">
        <span class="truncate type-row-title [font-weight:600] text-v2-text-text-base">{who.name}</span>
        <span class="truncate type-meta text-v2-text-text-muted">{who.sub}</span>
      </div>
    </div>
  )
  const Caption = (caption: { label: string; count?: number; children?: JSX.Element }) => (
    <div class="flex items-center gap-2">
      <h3 class="flex items-center gap-1.5 px-1 type-caption text-v2-text-text-muted">
        {caption.label}
        <Show when={caption.count !== undefined}>
          <span aria-hidden="true">·</span>
          <span class="tabular-nums">{caption.count}</span>
        </Show>
      </h3>
      {caption.children}
    </div>
  )

  const Band = () => {
    const who = () => sessionHarness(lead()?.session, Harness.OpenCode)
    const harness = () => who().harness
    return (
      <section data-component="hub-band" class={`${CARD} flex flex-wrap items-center gap-3 px-4 py-3`}>
        <Who
          harness={harness()}
          name={language.t("secondBrain.commandCentre.hub.lead")}
          sub={[harnessName(harness()), modelLabel(who().model, catalogue()[harness()])].filter(Boolean).join(" · ")}
        />
        <span class="mx-1 h-7 w-px bg-v2-border-border-muted" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 items-center gap-2 type-body text-v2-text-text-base">
          <Show
            when={totals().agents > 0}
            fallback={
              <span class="text-v2-text-text-muted">{language.t("secondBrain.commandCentre.hub.status.idle")}</span>
            }
          >
            <Dot />
            <span class="truncate">
              {language.t("secondBrain.commandCentre.hub.status.running", {
                projects: language.plural("secondBrain.commandCentre.hub.projectsCount", totals().projects, {
                  count: totals().projects,
                }),
                agents: language.plural("secondBrain.commandCentre.hub.agentsCount", totals().agents, {
                  count: totals().agents,
                }),
              })}
            </span>
          </Show>
        </div>
        <Show when={lead()}>
          {(thread) => (
            <ButtonV2 variant="ghost" onClick={() => props.open(thread().id)}>
              {language.t("secondBrain.commandCentre.hub.openThread")}
            </ButtonV2>
          )}
        </Show>
      </section>
    )
  }

  const Needs = () => (
    <Show when={waiting().length > 0}>
      <section data-component="hub-needs" class="flex flex-col gap-2">
        <Caption label={language.t("secondBrain.commandCentre.hub.needsYou")} count={waiting().length} />
        <ul class="flex flex-col gap-1.5">
          <For each={waiting().slice(0, NEEDS_SHOWN)}>
            {(entry) => {
              // What it asks, as the thread's approval card heads it, then what it would run or read.
              const asks = () => {
                const detail =
                  entry.permission?.patterns.join(" · ") ||
                  entry.question?.questions[0]?.question ||
                  language.t("secondBrain.sidebar.needsYou")
                if (!entry.permission) return detail
                const summary = permissionSummary(entry.permission)
                return `${language.plural(summary.key, summary.count, { count: summary.count, tool: summary.tool })}: ${detail}`
              }
              return (
                <li
                  data-need={entry.item.requestID}
                  class="animate-enter flex min-w-0 flex-wrap items-center gap-3 rounded-[16px] bg-v2-background-bg-layer-02 px-3.5 py-2.5"
                >
                  <span class="flex shrink-0 text-v2-state-fg-warning" aria-hidden="true">
                    <Icon name="warning" size="small" />
                  </span>
                  <div class="flex min-w-0 flex-[1_1_240px] flex-col">
                    <span class="truncate type-row-title [font-weight:600] text-v2-text-text-base">
                      {entry.root.project} › {entry.root.title}
                    </span>
                    <span class="truncate type-meta text-v2-text-text-muted">{asks()}</span>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <Show when={entry.permission}>
                      <ButtonV2
                        size="small"
                        variant="contrast"
                        data-action="hub-allow"
                        disabled={state.busy === entry.item.requestID}
                        onClick={() => answer(entry, "once")}
                      >
                        {language.t("secondBrain.commandCentre.hub.allow")}
                      </ButtonV2>
                      <ButtonV2
                        size="small"
                        variant="outline"
                        disabled={state.busy === entry.item.requestID}
                        onClick={() => answer(entry, "reject")}
                      >
                        {language.t("secondBrain.commandCentre.hub.deny")}
                      </ButtonV2>
                    </Show>
                    <ButtonV2 size="small" variant="ghost" onClick={() => props.open(entry.item.sessionID)}>
                      {language.t("common.open")}
                    </ButtonV2>
                  </div>
                  <Show when={state.failed === entry.item.requestID}>
                    <p role="alert" class="w-full type-meta text-v2-text-text-critical">
                      {language.t("common.requestFailed")}
                    </p>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
      </section>
    </Show>
  )

  const ProjectCard = (item: { card: HubCard; index: number }) => {
    const shown = () => item.card.harnesses.slice(0, 4)
    return (
      <button
        type="button"
        data-hub-project={item.card.id}
        class={`${CARD} animate-enter flex min-w-0 flex-col gap-3 px-[18px] py-4 text-left transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus`}
        style={{ "animation-delay": `${Math.min(item.index, 8) * 40}ms` }}
        onClick={() => props.selectProject(item.card.id)}
      >
        <div class="flex w-full items-start gap-2">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate type-toolbar-title [font-weight:600] text-v2-text-text-base">{item.card.name}</span>
            <span class="truncate type-meta text-v2-text-text-muted">{item.card.outcome}</span>
          </div>
          <StateLabel state={item.card.state} />
        </div>
        <div class="flex w-full flex-col gap-1.5">
          <div class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate type-body text-v2-text-text-base">
              {item.card.milestone ?? language.t("secondBrain.commandCentre.hub.noMilestone")}
            </span>
            <span class="type-meta tabular-nums text-v2-text-text-muted">{item.card.progress}%</span>
          </div>
          <Bar value={item.card.progress} />
        </div>
        <div class="flex min-h-6 w-full items-center gap-2">
          <Show
            when={shown().length > 0}
            fallback={
              <span class="type-meta text-v2-text-text-faint">
                {language.t("secondBrain.commandCentre.hub.noAgents")}
              </span>
            }
          >
            <span class="flex items-center" role="img" aria-label={shown().map(harnessName).join(", ")}>
              <For each={shown()}>
                {(harness, index) => (
                  <span
                    class="flex size-6 items-center justify-center rounded-full bg-v2-background-bg-layer-02 shadow-[0_0_0_2px_var(--v2-background-bg-layer-01)]"
                    style={{ "margin-left": index() ? "-6px" : "0" }}
                    title={harnessName(harness)}
                  >
                    {logo(harness, "size-3.5")}
                  </span>
                )}
              </For>
            </span>
          </Show>
          <span class="ml-auto type-meta text-v2-text-text-muted">
            {[
              item.card.working
                ? language.plural("secondBrain.commandCentre.hub.working", item.card.working, {
                    count: item.card.working,
                  })
                : "",
              item.card.needs
                ? language.plural("secondBrain.commandCentre.hub.needsCount", item.card.needs, {
                    count: item.card.needs,
                  })
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div class="flex w-full min-w-0 items-center gap-2 pt-2.5 shadow-[inset_0_1px_0_var(--v2-border-border-muted)]">
          <Show
            when={item.card.now}
            fallback={
              <span class="type-meta text-v2-text-text-faint">
                {language.t("secondBrain.commandCentre.hub.nothingYet")}
              </span>
            }
          >
            {(now) => (
              <>
                {logo(now().harness, "size-3.5")}
                <span class="min-w-0 flex-1 truncate type-meta text-v2-text-text-base">{now().title}</span>
                <span class="shrink-0 type-meta text-v2-text-text-faint">{ago(now().updated)}</span>
              </>
            )}
          </Show>
        </div>
      </button>
    )
  }

  const Hub = () => (
    <div data-component="command-hub" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-28 pt-1">
      <Band />
      <Needs />
      <section class="flex flex-col gap-2">
        <Caption label={language.t("secondBrain.commandCentre.hub.projects")} count={cards().length} />
        <Show
          when={cards().length > 0}
          fallback={
            <p class="px-1 type-body text-v2-text-text-muted">{language.t("secondBrain.commandCentre.hub.empty")}</p>
          }
        >
          <div class="grid grid-cols-1 gap-3 @[760px]:grid-cols-2 @[1180px]:grid-cols-3">
            <For each={cardIDs()}>
              {(id, index) => (
                <Show when={cardByID().get(id)}>{(item) => <ProjectCard card={item()} index={index()} />}</Show>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  )

  const PlanRow = (row: { text: string; status: string }) => (
    <li class="flex min-h-7 items-center gap-2.5">
      <StepMark status={row.status} />
      <span
        class="type-body"
        classList={{
          "text-v2-text-text-muted": row.status === "completed",
          "text-v2-text-text-base": row.status !== "completed",
          "[font-weight:500]": row.status === "in_progress",
        }}
      >
        {row.text}
      </span>
    </li>
  )

  const Lead = () => (
    <Show
      when={crew().lead}
      fallback={
        <section class={`${CARD} px-[18px] py-4 type-body text-v2-text-text-muted`}>
          {language.t("secondBrain.commandCentre.hub.noLead")}
        </section>
      }
    >
      {(value) => {
        const todos = () => serverSync().session.data.todo[value().id] ?? []
        const now = () => todoStep(todos())
        return (
          <section data-component="hub-lead" class={`${CARD} animate-enter flex flex-col gap-3 px-[18px] py-4`}>
            <div class="flex items-center gap-2.5">
              <Who
                harness={value().harness}
                name={language.t("secondBrain.commandCentre.hub.lead")}
                sub={[harnessName(value().harness), value().model].filter(Boolean).join(" · ")}
              />
              <span class="ml-auto flex items-center gap-1.5 type-caption text-v2-text-text-muted">
                <Show when={centre.working(value().id)}>
                  <Dot />
                </Show>
                {language.t(
                  centre.working(value().id)
                    ? "secondBrain.commandCentre.hub.coordinating"
                    : "secondBrain.commandCentre.hub.waiting",
                )}
              </span>
              <ButtonV2 variant="ghost" size="small" onClick={() => props.open(value().id)}>
                {language.t("secondBrain.commandCentre.hub.openThread")}
              </ButtonV2>
            </div>
            <div class="flex flex-col gap-0.5 pl-[38px]">
              <span class="type-meta text-v2-text-text-muted">{value().title}</span>
              <Show when={now()}>
                {(step) => (
                  <span class="type-body [font-weight:500] text-v2-text-text-base">
                    {language.t("secondBrain.commandCentre.hub.now", { text: step().text })}
                  </span>
                )}
              </Show>
            </div>
            <Show when={todos().length > 0}>
              <ul class="flex flex-col pl-[38px]">
                <For each={todos()}>{(todo) => <PlanRow text={todo.content} status={todo.status} />}</For>
              </ul>
            </Show>
          </section>
        )
      }}
    </Show>
  )

  const AgentStatus = (status: { agent: CrewAgent }) => (
    <div class="flex min-w-0 items-center gap-2">
      <Switch>
        <Match when={status.agent.state === "needs"}>
          <span class="flex shrink-0 text-v2-state-fg-warning" aria-hidden="true">
            <Icon name="warning" size="small" />
          </span>
          <span class="truncate type-meta text-v2-state-fg-warning">
            {language.t("secondBrain.commandCentre.hub.state.needs")}
          </span>
        </Match>
        <Match when={status.agent.state === "running"}>
          <Dot />
          <span class="truncate type-meta text-v2-text-text-base">
            {status.agent.step?.text ?? language.t("secondBrain.commandCentre.hub.state.running")}
            <Show when={status.agent.step}>
              {(step) => (
                <span class="tabular-nums text-v2-text-text-muted">
                  {" · "}
                  {language.t("secondBrain.commandCentre.hub.step", { n: step().n, of: step().of })}
                </span>
              )}
            </Show>
          </span>
        </Match>
        <Match when={true}>
          <span class="flex shrink-0 text-v2-icon-icon-muted" aria-hidden="true">
            <Icon name="check" size="small" />
          </span>
          <span class="truncate type-meta text-v2-text-text-muted">
            {language.t("secondBrain.commandCentre.hub.finished")} · {ago(status.agent.updated)}
          </span>
        </Match>
      </Switch>
    </div>
  )

  const AgentCard = (item: { agent: CrewAgent; index: number }) => {
    const progress = () => {
      const step = item.agent.step
      if (!step) return item.agent.state === "done" ? 100 : 0
      return item.agent.state === "done" ? 100 : Math.round((Math.max(0, step.n - 1) / step.of) * 100)
    }
    return (
      <button
        type="button"
        data-hub-agent={item.agent.id}
        aria-pressed={state.agent === item.agent.id}
        class="animate-enter flex min-w-0 flex-col gap-2.5 rounded-[16px] px-4 py-3.5 text-left transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
        classList={{
          "bg-v2-background-bg-layer-02": item.agent.state === "needs",
          "bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]":
            item.agent.state !== "needs" && state.agent !== item.agent.id,
          "bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1.5px_var(--v2-border-border-focus)]":
            state.agent === item.agent.id,
        }}
        style={{ "animation-delay": `${Math.min(item.index, 8) * 40}ms` }}
        onClick={() => setState("agent", state.agent === item.agent.id ? undefined : item.agent.id)}
      >
        <div class="flex w-full min-w-0 items-center gap-2.5">
          <Who
            harness={item.agent.harness}
            name={item.agent.model ?? harnessName(item.agent.harness)}
            sub={harnessName(item.agent.harness)}
          />
          <Show when={item.agent.commandCentre}>
            <span
              class="ml-auto flex shrink-0 items-center text-v2-icon-icon-muted"
              role="img"
              aria-label={language.t("secondBrain.sidebar.startedByCommandCentre")}
              title={language.t("secondBrain.sidebar.startedByCommandCentre")}
            >
              <Icon name="console" size="small" />
            </span>
          </Show>
        </div>
        <span class="line-clamp-2 min-h-10 type-body text-v2-text-text-base">{item.agent.title}</span>
        <AgentStatus agent={item.agent} />
        <Bar value={progress()} thin />
      </button>
    )
  }

  const Side = () => {
    const today = createMemo(() => {
      const ids = new Set((threads()[props.project ?? ""] ?? []).map((thread) => thread.id))
      return (actions() ?? [])
        .filter((action) => ids.has(action.sessionID))
        .toSorted((left, right) => right.at - left.at)
    })
    return (
      <div class="flex min-h-0 flex-col gap-3">
        <Show when={card()}>
          {(value) => (
            <section class={`${CARD} animate-enter flex flex-col gap-2.5 px-[18px] py-4`}>
              <div class="flex items-baseline gap-2">
                <span class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
                  {value().milestone ?? language.t("secondBrain.commandCentre.hub.noMilestone")}
                </span>
                <span class="type-meta tabular-nums text-v2-text-text-muted">{value().progress}%</span>
              </div>
              <Bar value={value().progress} />
              <span class="type-meta text-v2-text-text-muted">{value().outcome}</span>
            </section>
          )}
        </Show>
        <section class={`${CARD} animate-enter flex min-h-0 flex-col px-[18px] py-3.5`}>
          <span class="pb-1 type-section text-v2-text-text-base">
            {language.t("secondBrain.commandCentre.hub.activity")}
          </span>
          <Show
            when={today().length > 0}
            fallback={
              <p class="py-2 type-meta text-v2-text-text-muted">
                {language.t("secondBrain.commandCentre.hub.activityEmpty")}
              </p>
            }
          >
            <ul class="flex flex-col">
              <For each={today()}>
                {(action) => (
                  <li class="flex gap-2.5 py-2 shadow-[inset_0_-1px_0_var(--v2-border-border-muted)]">
                    <span class="flex-1 type-body text-v2-text-text-muted">
                      <span class="[font-weight:500] text-v2-text-text-base">{action.title}</span>
                      <Show when={action.text}>{(text) => <>: {text()}</>}</Show>
                    </span>
                    <span class="shrink-0 type-meta text-v2-text-text-faint">{ago(action.at)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>
    )
  }

  const AgentPanel = () => {
    const agent = () => crew().agents.find((item) => item.id === state.agent)
    return (
      <Presence when={!!agent()} class="absolute bottom-3 right-3 top-1 z-20 w-[420px] max-w-[calc(100%-24px)]">
        <Show when={agent()}>
          {(value) => {
            const todos = () => serverSync().session.data.todo[value().id] ?? []
            const reply = () => lastReplyText(serverSync().session.data, value().id).slice(0, 600)
            return (
              <aside
                data-component="hub-agent-panel"
                aria-label={value().model ?? harnessName(value().harness)}
                class="flex h-full flex-col overflow-hidden rounded-[24px] bg-v2-background-bg-floating shadow-[0_0_0_1px_var(--v2-border-border-muted),var(--v2-elevation-floating)]"
              >
                <div class="flex items-center gap-2.5 px-[18px] pb-3 pt-4">
                  <Who
                    harness={value().harness}
                    name={value().model ?? harnessName(value().harness)}
                    sub={harnessName(value().harness)}
                  />
                  <IconButtonV2
                    class="ml-auto"
                    variant="ghost-muted"
                    icon={<Icon name="close" size="small" />}
                    aria-label={language.t("common.close")}
                    onClick={() => setState("agent", undefined)}
                  />
                </div>
                <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-[18px] pb-[18px]">
                  <div class="flex flex-col gap-1">
                    <span class="type-section text-v2-text-text-base">{value().title}</span>
                    <Show when={value().commandCentre}>
                      <span class="flex items-center gap-1 type-meta text-v2-text-text-muted">
                        <Icon name="console" size="small" />
                        {language.t("secondBrain.sidebar.startedByCommandCentre")}
                      </span>
                    </Show>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <ButtonV2 variant="contrast" size="small" onClick={() => props.open(value().id)}>
                      {language.t("secondBrain.commandCentre.hub.openThread")}
                    </ButtonV2>
                    <Show when={value().state === "running"}>
                      <ButtonV2 variant="outline" size="small" onClick={() => stop(value().id)}>
                        {language.t("prompt.action.stop")}
                      </ButtonV2>
                    </Show>
                  </div>
                  <Show when={todos().length > 0}>
                    <div class="flex flex-col">
                      <span class="pb-1 type-caption text-v2-text-text-muted">
                        {language.t("secondBrain.commandCentre.hub.plan")}
                      </span>
                      <ul class="flex flex-col">
                        <For each={todos()}>{(todo) => <PlanRow text={todo.content} status={todo.status} />}</For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={reply()}>
                    <div class="flex flex-col gap-1.5">
                      <span class="type-caption text-v2-text-text-muted">
                        {language.t("secondBrain.commandCentre.hub.latest")}
                      </span>
                      <p class="whitespace-pre-wrap rounded-[16px] bg-v2-background-bg-layer-01 px-3.5 py-3 type-body text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                        {reply()}
                      </p>
                    </div>
                  </Show>
                </div>
              </aside>
            )
          }}
        </Show>
      </Presence>
    )
  }

  const ProjectView = () => (
    <div data-component="hub-project" class="relative flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-28 pt-1 @[1000px]:grid @[1000px]:grid-cols-[minmax(0,1fr)_380px] @[1000px]:items-start">
        <div class="flex min-w-0 flex-col gap-3">
          <Lead />
          <section class="flex flex-col gap-2">
            <Caption label={language.t("secondBrain.commandCentre.hub.agents")} count={crew().agents.length} />
            <Show
              when={crew().agents.length > 0}
              fallback={
                <p class="px-1 type-body text-v2-text-text-muted">
                  {language.t("secondBrain.commandCentre.hub.noCrew")}
                </p>
              }
            >
              <div class="grid grid-cols-1 gap-3 @[640px]:grid-cols-2">
                <For each={agentIDs()}>
                  {(id, index) => (
                    <Show when={agentByID().get(id)}>{(agent) => <AgentCard agent={agent()} index={index()} />}</Show>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
        <Side />
      </div>
      <AgentPanel />
    </div>
  )

  const Dock = () => (
    <div class="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-2 px-3">
      <Presence when={state.sheet} class="pointer-events-auto w-full max-w-[560px]">
        <section
          data-component="hub-sheet"
          role="dialog"
          aria-label={language.t("secondBrain.commandCentre.hub.lead")}
          class="flex max-h-[420px] flex-col overflow-hidden rounded-[24px] bg-v2-background-bg-floating shadow-[0_0_0_1px_var(--v2-border-border-muted),var(--v2-elevation-floating)]"
          onKeyDown={(event) => event.key === "Escape" && setState("sheet", false)}
        >
          <div class="flex items-center gap-2 px-[18px] pb-2 pt-3">
            {logo(sessionHarness(lead()?.session, Harness.OpenCode).harness)}
            <span class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
              {card()
                ? `${language.t("secondBrain.commandCentre.hub.lead")} · ${card()!.name}`
                : language.t("secondBrain.commandCentre.hub.lead")}
            </span>
            <Show when={lead()}>
              {(thread) => (
                <ButtonV2 size="small" variant="ghost" onClick={() => props.open(thread().id)}>
                  {language.t("secondBrain.commandCentre.hub.openThread")}
                </ButtonV2>
              )}
            </Show>
            <IconButtonV2
              variant="ghost-muted"
              icon={<Icon name="close" size="small" />}
              aria-label={language.t("common.close")}
              onClick={() => setState("sheet", false)}
            />
          </div>
          <div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-[18px] pb-4">
            <Show
              when={lead() && (centre.lastAsk() || centre.lastReply())}
              fallback={
                <p class="type-body text-v2-text-text-muted">
                  {language.t(
                    lead() ? "secondBrain.commandCentre.hub.noExchange" : "secondBrain.commandCentre.hub.noThread",
                  )}
                </p>
              }
            >
              <Show when={centre.lastAsk()}>
                <p class="self-end max-w-[80%] rounded-[18px] bg-v2-background-bg-layer-01 px-3.5 py-2 type-body text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                  {centre.lastAsk()}
                </p>
              </Show>
              <Show when={centre.lastReply()}>
                <p class="whitespace-pre-wrap text-[14px] leading-[22px] text-v2-text-text-base">
                  {centre.lastReply()}
                </p>
              </Show>
            </Show>
            <Show when={centre.error()}>
              <p role="alert" class="type-meta text-v2-text-text-critical">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </div>
        </section>
      </Presence>
      <form
        data-component="hub-dock"
        class="pointer-events-auto flex h-14 w-full max-w-[560px] items-center gap-2 rounded-[28px] bg-v2-background-bg-raised pl-5 pr-2.5 shadow-[0_0_0_1px_var(--v2-border-border-base),var(--v2-elevation-floating)] focus-within:shadow-[0_0_0_2px_var(--v2-border-border-focus),var(--v2-elevation-floating)]"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <input
          class="min-w-0 flex-1 bg-transparent text-[15px] text-v2-text-text-base outline-none placeholder:text-[13px] placeholder:text-v2-text-text-muted"
          value={state.text}
          aria-label={language.t("secondBrain.commandCentre.hub.ask")}
          placeholder={
            card()
              ? language.t("secondBrain.commandCentre.hub.steer", { project: card()!.name })
              : language.t("secondBrain.commandCentre.hub.ask")
          }
          onFocus={() => setState("sheet", true)}
          onInput={(event) => setState("text", event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Escape" && setState("sheet", false)}
        />
        <IconButtonV2
          type="submit"
          variant="ghost"
          icon={<Icon name="arrow-up" size="small" />}
          aria-label={language.t("secondBrain.commandCentre.hub.send")}
          disabled={!state.text.trim() || centre.sending()}
        />
      </form>
    </div>
  )

  return (
    <div class="@container relative flex min-h-0 flex-1 flex-col">
      <ViewSwitch class="flex min-h-0 flex-1 flex-col" key={props.project && card() ? props.project : "hub"}>
        <Show when={!!props.project && !!card()} fallback={<Hub />}>
          <ProjectView />
        </Show>
      </ViewSwitch>
      <Dock />
    </div>
  )
}

/** A checklist item's mark: a filled check when done, the spinner while in progress, a dashed circle to come. */
function StepMark(props: { status: string }) {
  return (
    <Switch
      fallback={
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="shrink-0">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--v2-icon-icon-muted)"
            stroke-width="1.4"
            stroke-dasharray="2.4 2.2"
          />
        </svg>
      }
    >
      <Match when={props.status === "completed"}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="shrink-0">
          <circle cx="8" cy="8" r="7" fill="var(--v2-background-bg-accent-container)" />
          <path
            d="M5 8.2l2 2 4-4.4"
            fill="none"
            stroke="var(--v2-text-text-on-accent-container)"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Match>
      <Match when={props.status === "in_progress"}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
          class="shrink-0 animate-spin motion-reduce:animate-none"
        >
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--v2-border-border-muted)" stroke-width="2" />
          <path
            d="M8 2a6 6 0 0 1 6 6"
            fill="none"
            stroke="var(--v2-icon-icon-accent)"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </Match>
    </Switch>
  )
}
