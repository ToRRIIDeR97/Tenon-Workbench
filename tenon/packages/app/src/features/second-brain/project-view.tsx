import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { prefersReducedMotion } from "@tenon/ui/v2/motion"
import { Icon } from "@tenon/ui/v2/icon"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { coverDataUrl } from "./project-cover-image"
import { coverMorphing, PROJECT_COVER_MORPH, useProjectCoverImage } from "./project-cover-cache"
import type { LogEntry, ProjectRecord, Timeline, TimelineItem, VaultPageInfo } from "./client"
import { milestoneGroups, timelineCounts, timelineLayout } from "./notes-timeline"
import { DateChip, KindSwitch } from "./project-controls"
import { createProjectTasks, ProjectTaskRow } from "./project-tasks"
import { linkedIssueNumbers } from "./github-tasks"
import { ProjectGithubTasks, ProjectRepository } from "./project-github-tasks"
import { ProjectComputerUse } from "./project-computer-use"
import { ProjectActionsMenu, useProjectCard } from "./project-details"
import { loadedView, PagesGrid, ProgressCard, type Loaded, type ProjectThread } from "./project-rail"
import { milestoneRoad, projectNumbers, projectStory } from "./project-home-model"
import {
  MilestoneRoad,
  ProjectCover,
  ProjectNumbers,
  ProjectStory,
  ProjectTile,
  SectionCount,
  scrollToSection,
  SectionIndex,
} from "./project-home"

export type { ProjectThread } from "./project-rail"

export const projectSections = ["tasks", "story", "pages", "threads", "log", "settings"] as const
const legacySection: Record<"threads" | "log", ProjectSection> = { threads: "story", log: "story" }
export type ProjectSection = (typeof projectSections)[number]

export function sectionFromTab(tab: string | undefined): ProjectSection | undefined {
  const legacy: Record<string, ProjectSection> = {
    timeline: "tasks",
    board: "tasks",
    table: "tasks",
    calendar: "tasks",
    docs: "pages",
    details: "settings",
  }
  return tab ? (legacy[tab] ?? projectSections.find((section) => section === tab)) : undefined
}

export function ProjectView(props: {
  project: ProjectRecord
  directory: string
  onArchived: () => void
  timeline: Loaded<Timeline>
  log: Loaded<ReadonlyArray<LogEntry>>
  pages: ReadonlyArray<VaultPageInfo>
  pageHref: (path: string) => string
  onPage: (path: string) => void
  onNewPage: () => void
  creatingPage: boolean
  pageError: string
  onSaveItems: (items: ReadonlyArray<TimelineItem>) => Promise<string>
  threads: ReadonlyArray<ProjectThread>
  threadHref: (id: string) => string
  onNewThread?: () => void
  onStartWork?: () => void
  onBack?: () => void
  section?: ProjectSection
}) {
  const language = useLanguage()
  const card = useProjectCard(props)
  const [coverState, setCoverState] = createStore({ busy: false })
  const cover = useProjectCoverImage(
    () => props.directory,
    () => props.project,
  )
  const morph = () => (coverMorphing() === props.project.id ? PROJECT_COVER_MORPH : undefined)
  const coverFailed = () => showToast({ variant: "error", title: language.t("secondBrain.project.cover.failed") })
  const chooseCover = async (file: File) => {
    setCoverState("busy", true)
    const dataUrl = await coverDataUrl(file).catch(() => undefined)
    const saved = dataUrl ? await card.cover.write(props.project, dataUrl).catch(() => undefined) : undefined
    setCoverState("busy", false)
    if (!saved || !dataUrl) return coverFailed()
    cover.saved(saved, dataUrl)
  }
  const removeCover = async () => {
    setCoverState("busy", true)
    const removed = await card.cover.remove(props.project).catch(() => undefined)
    setCoverState("busy", false)
    if (!removed) return coverFailed()
    cover.removed()
  }
  let coverInput: HTMLInputElement | undefined
  const coverControls = () => (
    <div class="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
      <Show when={props.onBack} fallback={<span />}>
        {(back) => (
          <TooltipV2 value={language.t("secondBrain.projects.back")}>
            <IconButtonV2
              type="button"
              variant="neutral"
              data-project-back
              class="!bg-v2-background-bg-base shadow-[0_0_0_1px_var(--v2-border-border-muted)]"
              aria-label={language.t("secondBrain.projects.back")}
              icon={<Icon name="arrow-left" />}
              onClick={() => back()()}
            />
          </TooltipV2>
        )}
      </Show>
      <MenuV2 gutter={4} modal={false} placement="bottom-end">
        <MenuV2.Trigger
          as={ButtonV2}
          size="small"
          variant="neutral"
          icon="photo"
          data-project-cover-menu
          disabled={coverState.busy}
          class="!bg-v2-background-bg-base shadow-[0_0_0_1px_var(--v2-border-border-muted)]"
        >
          {coverState.busy ? language.t("secondBrain.saving") : language.t("secondBrain.project.cover.menu")}
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={() => coverInput?.click()}>
              {language.t(props.project.cover ? "secondBrain.project.cover.change" : "secondBrain.project.cover.add")}
            </MenuV2.Item>
            <Show when={props.project.cover}>
              <MenuV2.Item onSelect={() => void removeCover()}>
                {language.t("secondBrain.project.cover.remove")}
              </MenuV2.Item>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
      <input
        ref={coverInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="hidden"
        data-project-cover-input
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          if (file) void chooseCover(file)
        }}
      />
    </div>
  )
  const [state, setState] = createStore({
    show: "open" as "open" | "all",
    draft: { title: "", kind: "task" as TimelineItem["kind"], date: undefined as string | undefined },
  })
  const items = () => props.timeline.value?.items ?? []
  const counts = createMemo(() => timelineCounts(items()))
  const groups = createMemo(() => milestoneGroups(items(), state.show === "open"))
  const percent = () => counts().percent ?? 0
  const shortDate = (value: string) => {
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
    if (!Number.isFinite(date.getTime())) return ""
    return date.toLocaleDateString(language.intl(), { day: "numeric", month: "short", timeZone: "UTC" })
  }
  const progress = () => {
    const params = { percent: percent(), done: counts().done, total: counts().total }
    const next = counts().next
    if (!next) return language.t("secondBrain.vault.progress", params)
    return language.t(next.start ? "secondBrain.vault.progressNextDate" : "secondBrain.vault.progressNext", {
      ...params,
      title: next.title,
      date: next.start ? shortDate(next.start) : "",
    })
  }
  createEffect(
    on(
      () =>
        [
          !props.timeline.loading && props.timeline.value?.projectId === props.project.id
            ? counts().percent
            : undefined,
          props.project.progressPercent,
        ] as const,
      ([computed, stored]) => {
        if (computed === undefined || computed === stored) return
        void card.syncProgress(computed)
      },
    ),
  )
  const outcome = () => props.project.outcome.trim()
  const projectFolder = () => {
    const path = props.project.location?.path
    if (!path) return undefined
    return /^([a-zA-Z]:)?[\\/]/.test(path) ? path : `${props.directory.replace(/[\\/]+$/, "")}/${path}`
  }

  const tasks = createProjectTasks({ items, onSaveItems: (next) => props.onSaveItems(next) })
  const add = async (event: SubmitEvent) => {
    event.preventDefault()
    const title = state.draft.title.trim()
    if (!title) return
    const date = state.draft.date
    const item: TimelineItem = {
      id: `item_${crypto.randomUUID()}`,
      title,
      kind: state.draft.kind,
      status: "todo",
      ...(date ? (state.draft.kind === "milestone" ? { start: date } : { end: date }) : {}),
    }
    if (await tasks.save([...items(), item])) setState("draft", { title: "", date: undefined })
  }

  createEffect(
    on(
      () => [props.project.id, props.section] as const,
      ([, section]) => {
        if (!section) return
        queueMicrotask(() =>
          scrollToSection(section === "threads" || section === "log" ? legacySection[section] : section),
        )
      },
    ),
  )

  let addInput: HTMLInputElement | undefined
  const addMilestone = () => {
    setState("draft", "kind", "milestone")
    if (!addInput?.isConnected) return
    addInput.focus({ preventScroll: true })
    addInput.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" })
  }
  const road = createMemo(() => milestoneRoad(items()))
  const numbers = createMemo(() => projectNumbers(items(), props.threads, props.pages.length))
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(tick))
  const story = createMemo(() => projectStory(props.threads, props.log.value ?? [], now()))
  const blocker = () => props.project.blocker?.trim()
  const sections = () => [
    { id: "tasks", label: language.t("secondBrain.project.tasks") },
    { id: "story", label: language.t("secondBrain.project.story") },
    { id: "pages", label: language.t("secondBrain.project.pages") },
    { id: "settings", label: language.t("secondBrain.project.settings") },
  ]
  const sectionHeading = "flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1"

  return (
    <div data-project-page={props.project.id} class="@container w-full">
      <ProjectCover bleed class="hidden @min-[1400px]:block" image={cover.image()} morph={morph()}>
        {coverControls()}
      </ProjectCover>
      <div class="mx-auto grid w-full max-w-[1340px] grid-cols-1 gap-x-10 gap-y-8 px-6 pb-12 pt-6 sm:px-10 @min-[960px]:grid-cols-[120px_minmax(0,1100px)] @min-[960px]:justify-center @min-[1400px]:max-w-[1680px] @min-[1400px]:grid-cols-1 @min-[1400px]:px-14">
        <div class="flex min-w-0 flex-col gap-8 @min-[960px]:col-start-2 @min-[1400px]:col-start-1">
          <ProjectCover class="@min-[1400px]:hidden" image={cover.image()} morph={morph()}>
            {coverControls()}
          </ProjectCover>
          <header class="-mt-[68px] flex flex-col gap-2 px-1 animate-enter @min-[1400px]:-mt-[60px]">
            <ProjectTile name={props.project.name} />
            <div class="mt-1 flex flex-wrap items-center gap-3">
              <h1 class="min-w-0 break-words type-page-title text-v2-text-text-base">{props.project.name}</h1>
              <ProjectStatusChip status={props.project.status} />
              <span class="flex-1" />
              <ProjectActionsMenu project={props.project} card={card} />
              <ButtonV2 variant="contrast" disabled={!props.onStartWork} onClick={() => props.onStartWork?.()}>
                {language.t("secondBrain.projects.startWork")}
              </ButtonV2>
            </div>
            <Show when={outcome() && outcome() !== props.project.name.trim()}>
              <p class="max-w-3xl type-body text-v2-text-text-muted">{outcome()}</p>
            </Show>
            <Show when={blocker()}>
              {(text) => (
                <a
                  href="#project-settings"
                  data-project-blocker-chip
                  class="flex w-fit max-w-full items-start gap-1.5 rounded-[10px] bg-v2-state-bg-warning px-2.5 py-1 type-meta text-v2-state-fg-warning transition-opacity duration-short ease-standard hover:opacity-90 motion-reduce:transition-none"
                  onClick={(event) => {
                    event.preventDefault()
                    scrollToSection("settings")
                  }}
                >
                  <Icon name="warning" size="small" class="mt-px shrink-0" />
                  <span class="min-w-0 break-words">
                    {language.t("secondBrain.projects.blocker")}: {text()}
                  </span>
                </a>
              )}
            </Show>
            <Show
              when={props.timeline.value}
              fallback={<Show when={props.timeline.loading}>{<div aria-hidden="true" class="mt-2 h-[76px]" />}</Show>}
            >
              <MilestoneRoad road={road()} dateLabel={shortDate} onAdd={addMilestone} />
            </Show>
          </header>
          <ProjectNumbers numbers={numbers()} tasksKnown={!!props.timeline.value} />
        </div>

        <Show when={props.project.id} keyed>
          {(projectId) => (
            <SectionIndex
              projectId={projectId}
              sections={sections()}
              endId="project-sections-end"
              class="sticky top-6 hidden self-start @min-[960px]:col-start-1 @min-[960px]:row-start-2 @min-[960px]:flex @min-[1400px]:hidden"
            />
          )}
        </Show>

        <div class="flex min-w-0 flex-col gap-10 @min-[960px]:col-start-2 @min-[960px]:row-start-2 @min-[1400px]:col-start-1 @min-[1400px]:grid @min-[1400px]:grid-cols-[360px_minmax(0,1fr)] @min-[1400px]:items-start @min-[1400px]:gap-x-10">
          <div
            data-project-main
            class="flex min-w-0 flex-col gap-10 @min-[1400px]:col-start-2 @min-[1400px]:row-start-1"
          >
            <section
              id="project-tasks"
              aria-labelledby="project-tasks-title"
              class="flex min-w-0 scroll-mt-6 flex-col gap-3"
            >
              <div class={sectionHeading}>
                <h2 id="project-tasks-title" class="type-section text-v2-text-text-base">
                  {language.t("secondBrain.project.tasks")}
                </h2>
                <Show when={props.timeline.value}>
                  <SectionCount>
                    {language.plural("secondBrain.project.count.open", numbers().open, { count: numbers().open })}
                  </SectionCount>
                  <span class="min-w-0 flex-1 truncate type-caption text-v2-text-text-muted">{progress()}</span>
                </Show>
                <SegmentedControlV2
                  class="!w-auto ml-auto"
                  aria-label={language.t("secondBrain.project.show")}
                  value={state.show}
                  onChange={(value) => value && setState("show", value === "all" ? "all" : "open")}
                >
                  <SegmentedControlItemV2 value="open">
                    {language.t("secondBrain.project.show.open")}
                  </SegmentedControlItemV2>
                  <SegmentedControlItemV2 value="all">
                    {language.t("secondBrain.project.show.all")}
                  </SegmentedControlItemV2>
                </SegmentedControlV2>
              </div>
              {loadedView(props.timeline, () => (
                <div class="flex flex-col divide-y divide-v2-border-border-muted rounded-[16px] bg-v2-background-bg-layer-01 py-1 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                  <form
                    class="flex min-h-12 flex-wrap items-center gap-2 px-4 py-1.5"
                    onSubmit={(event) => void add(event)}
                  >
                    <Icon name="plus" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <input
                      ref={(element) => (addInput = element)}
                      class="h-8 min-w-[180px] flex-1 bg-transparent text-[13px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                      aria-label={language.t("secondBrain.project.addTask")}
                      placeholder={language.t(
                        state.draft.kind === "milestone"
                          ? "secondBrain.project.addMilestoneHint"
                          : "secondBrain.project.addTaskHint",
                      )}
                      maxLength={200}
                      value={state.draft.title}
                      onInput={(event) => setState("draft", "title", event.currentTarget.value)}
                    />
                    <DateChip
                      value={state.draft.date}
                      label={language.t("secondBrain.project.dueDate")}
                      onChange={(date) => setState("draft", "date", date)}
                    />
                    <KindSwitch value={state.draft.kind} onChange={(kind) => setState("draft", "kind", kind)} />
                  </form>
                  <For each={groups()}>
                    {(group) => (
                      <div
                        role="group"
                        aria-label={group.milestone?.title ?? language.t("secondBrain.project.tasks")}
                        data-milestone-group={group.milestone?.id ?? ""}
                        class="flex flex-col divide-y divide-v2-border-border-muted"
                      >
                        <Show when={group.milestone}>
                          {(milestone) => <ProjectTaskRow tasks={tasks} item={milestone()} group={group} />}
                        </Show>
                        <Show when={group.tasks.length > 0}>
                          <ul class="flex flex-col divide-y divide-v2-border-border-muted">
                            <For each={group.tasks}>
                              {(task) => (
                                <li>
                                  <ProjectTaskRow tasks={tasks} item={task} />
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </div>
                    )}
                  </For>
                  <ProjectGithubTasks
                    projectId={props.project.id}
                    folder={projectFolder()}
                    show={state.show}
                    linked={linkedIssueNumbers(items().map((item) => item.title))}
                  />
                </div>
              ))}
              <RevealShow when={tasks.state.error}>
                {(error) => (
                  <p role="alert" class="px-1 type-caption text-v2-text-text-critical">
                    {error()}
                  </p>
                )}
              </RevealShow>
              <Show when={items().some((item) => item.start || item.end)}>
                <TimelineGrid
                  items={items().filter(
                    (item) => state.show === "all" || item.kind === "milestone" || item.status !== "done",
                  )}
                  dateLabel={shortDate}
                />
              </Show>
            </section>

            <section
              id="project-story"
              aria-labelledby="project-story-title"
              class="flex min-w-0 scroll-mt-6 flex-col gap-3"
            >
              <div class={sectionHeading}>
                <h2 id="project-story-title" class="type-section text-v2-text-text-base">
                  {language.t("secondBrain.project.story")}
                </h2>
                <Show when={numbers().running > 0}>
                  <SectionCount>
                    {language.plural("secondBrain.project.count.running", numbers().running, {
                      count: numbers().running,
                    })}
                  </SectionCount>
                </Show>
                <span class="flex-1" />
                <ButtonV2
                  size="small"
                  variant="ghost"
                  icon="plus"
                  disabled={!props.onNewThread}
                  onClick={() => props.onNewThread?.()}
                >
                  {language.t("secondBrain.project.newThread")}
                </ButtonV2>
              </div>
              <Show when={props.project.id} keyed>
                {(projectId) => (
                  <ProjectStory
                    projectId={projectId}
                    days={story()}
                    next={road().current}
                    log={props.log.failed ? "failed" : props.log.value ? "ready" : "loading"}
                    onRetryLog={props.log.retry}
                    now={now()}
                    threadHref={props.threadHref}
                    dateLabel={shortDate}
                  />
                )}
              </Show>
            </section>
          </div>

          <div
            data-project-side
            class="flex min-w-0 flex-col gap-10 @min-[1400px]:col-start-1 @min-[1400px]:row-start-1"
          >
            <section
              id="project-pages"
              aria-labelledby="project-pages-title"
              class="flex min-w-0 scroll-mt-6 flex-col gap-3"
            >
              <div class={sectionHeading}>
                <h2 id="project-pages-title" class="type-section text-v2-text-text-base">
                  {language.t("secondBrain.project.pages")}
                </h2>
                <SectionCount>{props.pages.length.toLocaleString(language.intl())}</SectionCount>
              </div>
              <PagesGrid
                pages={props.pages}
                pageHref={props.pageHref}
                onPage={props.onPage}
                onNewPage={props.onNewPage}
                creatingPage={props.creatingPage}
                pageError={props.pageError}
                dateLabel={shortDate}
              />
            </section>

            <section
              id="project-settings"
              aria-labelledby="project-settings-title"
              class="flex min-w-0 scroll-mt-6 flex-col gap-3"
            >
              <div class={sectionHeading}>
                <h2 id="project-settings-title" class="type-section text-v2-text-text-base">
                  {language.t("secondBrain.project.settings")}
                </h2>
              </div>
              <ProgressCard card={card} tasks={counts().percent === undefined ? undefined : counts()} />
              <ProjectRepository folder={projectFolder()} />
              <ProjectComputerUse folder={projectFolder()} />
            </section>
          </div>
          <div id="project-sections-end" aria-hidden="true" class="h-px @min-[1400px]:col-span-2" />
        </div>
      </div>
    </div>
  )
}

export function ProjectStatusChip(props: { status: ProjectRecord["status"] }) {
  const language = useLanguage()
  return (
    <span
      data-project-status={props.status}
      class="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-02 px-2.5 type-meta text-v2-text-text-muted"
    >
      <span
        aria-hidden="true"
        classList={{
          "size-1.5 rounded-full": true,
          "bg-v2-icon-icon-accent": props.status === "active",
          "bg-v2-icon-icon-muted": props.status !== "active",
        }}
      />
      {language.t(`secondBrain.projects.filter.${props.status}`)}
    </span>
  )
}

function TimelineGrid(props: { items: ReadonlyArray<TimelineItem>; dateLabel: (value: string) => string }) {
  const language = useLanguage()
  const layout = createMemo(() => timelineLayout(props.items))
  const step = () => Math.max(1, Math.ceil(layout().weeks.length / 10))
  const grid = () => ({
    "background-image": "linear-gradient(to right, var(--v2-border-border-muted) 1px, transparent 1px)",
    "background-size": `${100 / Math.max(1, layout().weeks.length)}% 100%`,
  })
  return (
    <div class="overflow-x-auto rounded-[16px] bg-v2-background-bg-layer-01 px-4 py-3 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
      <div class="flex min-w-[640px] flex-col">
        <div class="grid h-8 grid-cols-[200px_minmax(0,1fr)] items-center text-[12px] text-v2-text-text-muted">
          <span />
          <div class="flex">
            <For each={layout().weeks}>
              {(week, index) => (
                <span class="min-w-0 flex-1 truncate pl-1.5 tabular-nums">
                  {index() % step() === 0 ? props.dateLabel(week) : ""}
                </span>
              )}
            </For>
          </div>
        </div>
        <For each={layout().rows}>
          {(row) => (
            <div
              data-timeline-item={row.item.id}
              data-kind={row.item.kind}
              data-status={row.item.status}
              class="grid h-9 grid-cols-[200px_minmax(0,1fr)] items-center"
            >
              <span class="min-w-0 truncate pr-3 text-[13px] text-v2-text-text-base" title={row.item.title}>
                {row.item.title}
              </span>
              <div class="relative h-full" style={grid()}>
                <Show
                  when={row.left !== undefined}
                  fallback={
                    <span class="absolute inset-y-0 left-1.5 flex items-center text-[12px] text-v2-text-text-muted">
                      {language.t("secondBrain.vault.timeline.undated")}
                    </span>
                  }
                >
                  <Show
                    when={row.item.kind === "milestone"}
                    fallback={
                      <span
                        title={`${row.item.title} · ${language.t(`secondBrain.vault.status.${row.item.status}`)}`}
                        classList={{
                          "absolute top-1/2 h-5 -translate-y-1/2 rounded-full": true,
                          "bg-v2-icon-icon-accent": row.item.status === "doing",
                          "bg-v2-icon-icon-muted": row.item.status === "done",
                          "bg-v2-background-bg-layer-03 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]":
                            row.item.status === "todo",
                        }}
                        style={{ left: `${row.left}%`, width: `max(${row.width}%, 8px)` }}
                      />
                    }
                  >
                    <span
                      class="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[12px] text-v2-text-text-accent"
                      style={{ left: `calc(${row.left}% + 0.5em)` }}
                    >
                      <span aria-hidden="true">◆</span>
                      <span>{language.t("secondBrain.vault.milestone")}</span>
                    </span>
                  </Show>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
