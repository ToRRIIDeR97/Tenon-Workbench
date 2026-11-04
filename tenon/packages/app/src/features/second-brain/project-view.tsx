import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createEffect, createMemo, For, on, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { PageEmpty } from "@/components/page"
import { getRelativeTime } from "@/utils/time"
import type { LogEntry, ProjectRecord, Timeline, TimelineItem, VaultPageInfo } from "./client"
import { timelineCounts, timelineLayout } from "./notes-timeline"
import { dayLabel, DateChip, KindSwitch, StatusMenu } from "./project-controls"

export const projectSections = ["tasks", "pages", "threads", "log", "settings"] as const
export type ProjectSection = (typeof projectSections)[number]

/** The section an older `?tab=` link means; the tabs became sections of one page. */
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

type Loaded<T> = { value?: T; loading: boolean; failed: boolean; retry: () => void }
export type ProjectThread = { id: string; title: string; updated: number; running: boolean }

/**
 * A Project as one scrolling page: title, outcome and progress; a sticky bar that jumps to Tasks, Pages, Threads,
 * Log and Settings and holds Start work; and each section adds in place (a task line, a New page card, New
 * thread). Tasks and milestones are the Project's timeline items, saved whole through `onSaveItems`.
 */
export function ProjectView(props: {
  project: ProjectRecord
  timeline: Loaded<Timeline>
  log: Loaded<ReadonlyArray<LogEntry>>
  pages: ReadonlyArray<VaultPageInfo>
  pageHref: (path: string) => string
  onPage: (path: string) => void
  onNewPage: () => void
  creatingPage: boolean
  /** Saves the whole item list over the loaded revision; resolves to an error message, or "" when saved. */
  onSaveItems: (items: ReadonlyArray<TimelineItem>) => Promise<string>
  threads: ReadonlyArray<ProjectThread>
  threadHref: (id: string) => string
  /** Absent when the Project has no folder to run threads in. */
  onNewThread?: () => void
  onStartWork?: () => void
  /** The Settings section: the Project's card (progress, milestone, blocker, settings, status). */
  settings: JSX.Element
  /** A section to scroll to on open (from an older link or an agent write's Open). */
  section?: ProjectSection
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    show: "open" as "open" | "all",
    saving: false,
    error: "",
    draft: { title: "", kind: "task" as TimelineItem["kind"], date: undefined as string | undefined },
    settingsOpen: props.section === "settings",
  })
  const items = () => props.timeline.value?.items ?? []
  const counts = createMemo(() => timelineCounts(items()))
  const percent = () => Math.round((props.timeline.value?.progress ?? 0) * 100)
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
  // A task's date is its due day (end); a milestone's is its day (start).
  const dueOf = (item: TimelineItem) => (item.kind === "milestone" ? item.start : (item.end ?? item.start))
  const shown = () => items().filter((item) => state.show === "all" || item.status !== "done")

  const save = async (next: ReadonlyArray<TimelineItem>) => {
    if (state.saving) return false
    setState({ saving: true, error: "" })
    const error = await props.onSaveItems(next)
    setState({ saving: false, error })
    return !error
  }
  const update = (id: string, patch: Partial<TimelineItem>) =>
    void save(items().map((item) => (item.id === id ? { ...item, ...patch } : item)))
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
    if (await save([...items(), item])) setState("draft", { title: "", date: undefined })
  }

  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const jump = (section: ProjectSection) => {
    if (section === "settings") setState("settingsOpen", true)
    queueMicrotask(() =>
      document
        .getElementById(`project-${section}`)
        ?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }),
    )
  }
  createEffect(
    on(
      () => [props.project.id, props.section] as const,
      ([, section]) => {
        if (section) jump(section)
      },
    ),
  )

  const loaded = <T,>(source: Loaded<T>, view: (value: T) => JSX.Element) => (
    <Show
      when={!source.failed}
      fallback={
        <PageEmpty
          error
          title={language.t("secondBrain.state.error.title")}
          action={
            <ButtonV2 size="small" variant="outline" onClick={source.retry}>
              {language.t("secondBrain.state.retry")}
            </ButtonV2>
          }
        >
          {language.t("secondBrain.state.error.body")}
        </PageEmpty>
      }
    >
      <Show when={source.value} fallback={<PageEmpty loading={source.loading} title={language.t("common.loading")} />}>
        {(value) => view(value())}
      </Show>
    </Show>
  )
  const heading = (section: ProjectSection, actions?: JSX.Element) => (
    <div class="flex min-h-8 items-center gap-2">
      <h2 id={`project-${section}-title`} class="min-w-0 flex-1 text-[15px] text-v2-text-text-base [font-weight:600]">
        {language.t(`secondBrain.project.${section}`)}
      </h2>
      {actions}
    </div>
  )
  const panel = "rounded-[20px] bg-v2-background-bg-layer-01"

  return (
    <div class="flex min-h-0 flex-col">
      <nav
        aria-label={language.t("secondBrain.project.sections")}
        class="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-1 border-b border-v2-border-border-muted bg-v2-background-bg-base px-6 py-2 sm:px-10"
      >
        <span class="mr-2 max-w-48 truncate text-[13px] text-v2-text-text-base [font-weight:600]">
          {props.project.name}
        </span>
        <For each={projectSections}>
          {(section) => (
            <button
              type="button"
              data-section-link={section}
              class="rounded-full px-2.5 py-1 text-[13px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
              onClick={() => jump(section)}
            >
              {language.t(`secondBrain.project.${section}`)}
            </button>
          )}
        </For>
        <span class="flex-1" />
        <ButtonV2 size="small" variant="contrast" disabled={!props.onStartWork} onClick={() => props.onStartWork?.()}>
          {language.t("secondBrain.projects.startWork")}
        </ButtonV2>
      </nav>

      <div class="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-6 pb-12 pt-6 sm:px-10">
        <header class="flex flex-col gap-2.5">
          <h1 class="break-words text-[28px] leading-[38px] text-v2-text-text-base [font-weight:700]">
            {props.project.name}
          </h1>
          <Show when={props.project.outcome}>
            <p class="max-w-3xl text-[15px] leading-6 text-v2-text-text-base">{props.project.outcome}</p>
          </Show>
          <Show when={props.timeline.value}>
            <div class="flex flex-wrap items-center gap-3 text-[13px] text-v2-text-text-muted">
              <span
                class="h-2 w-56 overflow-hidden rounded-full bg-v2-background-bg-layer-02"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={percent()}
                aria-label={language.t("secondBrain.projects.progress")}
              >
                <span
                  class="block h-full rounded-full bg-v2-background-bg-accent transition-[width] duration-medium ease-standard motion-reduce:transition-none"
                  style={{ width: `${percent()}%` }}
                />
              </span>
              <span>{progress()}</span>
            </div>
          </Show>
        </header>

        <section id="project-tasks" aria-labelledby="project-tasks-title" class="flex scroll-mt-16 flex-col gap-3">
          {heading(
            "tasks",
            <SegmentedControlV2
              class="!w-auto"
              aria-label={language.t("secondBrain.project.show")}
              value={state.show}
              onChange={(value) => value && setState("show", value === "all" ? "all" : "open")}
            >
              <SegmentedControlItemV2 value="open">
                {language.t("secondBrain.project.show.open")}
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="all">{language.t("secondBrain.project.show.all")}</SegmentedControlItemV2>
            </SegmentedControlV2>,
          )}
          {loaded(props.timeline, () => (
            <div class={`${panel} flex flex-col px-4 py-1`}>
              <ul class="flex flex-col" aria-label={language.t("secondBrain.project.tasks")}>
                <For each={shown()}>
                  {(item) => (
                    <li
                      data-task={item.id}
                      data-kind={item.kind}
                      data-status={item.status}
                      class="flex min-h-11 items-center gap-3 border-b border-v2-border-border-muted"
                    >
                      <Show
                        when={item.kind === "task"}
                        fallback={
                          <span aria-hidden="true" class="flex w-4 justify-center text-v2-icon-icon-accent">
                            ◆
                          </span>
                        }
                      >
                        <CheckboxV2
                          hideLabel
                          shape="round"
                          label={item.title}
                          checked={item.status === "done"}
                          disabled={state.saving}
                          onChange={(checked) => update(item.id, { status: checked ? "done" : "todo" })}
                        />
                      </Show>
                      <span
                        classList={{
                          "min-w-0 flex-1 truncate text-[13px]": true,
                          "text-v2-text-text-faint line-through": item.status === "done",
                          "text-v2-text-text-base": item.status !== "done",
                        }}
                      >
                        {item.title}
                      </span>
                      <StatusMenu
                        value={item.status}
                        label={language.t("secondBrain.project.statusOf", { title: item.title })}
                        disabled={state.saving}
                        onChange={(status) => update(item.id, { status })}
                      />
                      <span class="w-24 shrink-0 text-right text-[12px] tabular-nums text-v2-text-text-faint">
                        {dayLabel(dueOf(item), language.intl())}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
              <form class="flex min-h-12 flex-wrap items-center gap-2 py-1.5" onSubmit={(event) => void add(event)}>
                <Icon name="plus" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                <input
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
            </div>
          ))}
          <RevealShow when={state.error}>
            {(error) => (
              <p role="alert" class="px-1 text-[12px] text-v2-text-text-critical">
                {error()}
              </p>
            )}
          </RevealShow>
          <Show when={items().some((item) => item.start || item.end)}>
            <TimelineGrid items={items()} dateLabel={shortDate} />
          </Show>
        </section>

        <section id="project-pages" aria-labelledby="project-pages-title" class="flex scroll-mt-16 flex-col gap-3">
          {heading("pages")}
          <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <button
                type="button"
                data-action="project-new-page"
                disabled={props.creatingPage}
                class="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-[20px] text-[13px] text-v2-text-text-muted shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50 motion-reduce:transition-none"
                onClick={props.onNewPage}
              >
                <Icon name="plus" size="small" />
                {language.t("secondBrain.vault.newPage")}
              </button>
            </li>
            <For each={props.pages}>
              {(page) => (
                <li>
                  <a
                    href={props.pageHref(page.path)}
                    class={`${panel} flex h-24 flex-col gap-1.5 p-4 transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none`}
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
                      event.preventDefault()
                      props.onPage(page.path)
                    }}
                  >
                    <span class="truncate text-[13px] text-v2-text-text-base [font-weight:500]">{page.title}</span>
                    {/* A hand-edited `updated_at` may not parse; the server then sends "". */}
                    <Show when={Number.isFinite(Date.parse(page.updatedAt))}>
                      <span class="mt-auto text-[12px] tabular-nums text-v2-text-text-faint">
                        {shortDate(new Date(page.updatedAt).toISOString())}
                      </span>
                    </Show>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </section>

        <section id="project-threads" aria-labelledby="project-threads-title" class="flex scroll-mt-16 flex-col gap-3">
          {heading(
            "threads",
            <ButtonV2
              size="small"
              variant="ghost"
              icon="plus"
              disabled={!props.onNewThread}
              onClick={() => props.onNewThread?.()}
            >
              {language.t("secondBrain.project.newThread")}
            </ButtonV2>,
          )}
          <Show
            when={props.threads.length > 0}
            fallback={
              <p class="px-1 text-[13px] text-v2-text-text-faint">{language.t("secondBrain.project.threadsEmpty")}</p>
            }
          >
            <ul class={`${panel} flex flex-col px-4 py-1`}>
              <For each={props.threads}>
                {(thread) => (
                  <li class="border-b border-v2-border-border-muted last:border-b-0">
                    <a href={props.threadHref(thread.id)} class="flex min-h-11 items-center gap-3 text-[13px]">
                      <span
                        aria-hidden="true"
                        classList={{
                          "size-2 shrink-0 rounded-full": true,
                          "bg-v2-icon-icon-accent running-pulse": thread.running,
                          "bg-v2-background-bg-layer-03": !thread.running,
                        }}
                      />
                      <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{thread.title}</span>
                      <span class="shrink-0 text-[12px] text-v2-text-text-faint">
                        {getRelativeTime(new Date(thread.updated).toISOString(), language.t)}
                      </span>
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section id="project-log" aria-labelledby="project-log-title" class="flex scroll-mt-16 flex-col gap-3">
          {heading("log")}
          {loaded(props.log, (entries) => (
            <Show
              when={entries.length > 0}
              fallback={
                <p class="px-1 text-[13px] text-v2-text-text-faint">{language.t("secondBrain.vault.log.empty")}</p>
              }
            >
              <ol class={`${panel} flex flex-col gap-px px-2 py-2`}>
                <For each={entries}>
                  {(entry) => (
                    <li class="flex min-w-0 items-baseline gap-3 rounded-[12px] px-2 py-1.5">
                      <time
                        datetime={entry.at}
                        class="w-32 min-w-0 shrink truncate whitespace-nowrap text-[12px] tabular-nums text-v2-text-text-faint"
                      >
                        {new Date(entry.at).toLocaleString(language.intl(), {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <span class="w-20 min-w-0 shrink truncate text-[12px] text-v2-text-text-muted">
                        {entry.author}
                      </span>
                      <span class="min-w-0 flex-1 text-[13px] text-v2-text-text-base">{entry.text}</span>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          ))}
        </section>

        <section
          id="project-settings"
          aria-labelledby="project-settings-title"
          class="flex scroll-mt-16 flex-col gap-3"
        >
          <button
            type="button"
            aria-expanded={state.settingsOpen}
            aria-controls="project-settings-body"
            class="flex w-fit items-center gap-2 rounded-full pr-2 text-left"
            onClick={() => setState("settingsOpen", (open) => !open)}
          >
            <h2 id="project-settings-title" class="text-[15px] text-v2-text-text-base [font-weight:600]">
              {language.t("secondBrain.project.settings")}
            </h2>
            <Icon
              name="chevron-down"
              size="small"
              classList={{
                "text-v2-icon-icon-muted transition-transform duration-short motion-reduce:transition-none": true,
                "-rotate-90": !state.settingsOpen,
              }}
            />
          </button>
          <Show when={state.settingsOpen}>
            <div id="project-settings-body">{props.settings}</div>
          </Show>
        </section>
      </div>
    </div>
  )
}

/** One row per item over a grid of weeks: a bar from start to end, or ◆ on a milestone's date. */
function TimelineGrid(props: { items: ReadonlyArray<TimelineItem>; dateLabel: (value: string) => string }) {
  const language = useLanguage()
  const layout = createMemo(() => timelineLayout(props.items))
  // Label at most about ten weeks so long plans stay readable.
  const step = () => Math.max(1, Math.ceil(layout().weeks.length / 10))
  const grid = () => ({
    "background-image": "linear-gradient(to right, var(--v2-border-border-muted) 1px, transparent 1px)",
    "background-size": `${100 / Math.max(1, layout().weeks.length)}% 100%`,
  })
  return (
    <div class="overflow-x-auto rounded-[20px] bg-v2-background-bg-layer-01 px-4 py-3">
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
              <span class="min-w-0 truncate pr-3 text-[13px] text-v2-text-text-base">{row.item.title}</span>
              <div class="relative h-full" style={grid()}>
                <Show
                  when={row.left !== undefined}
                  fallback={
                    <span class="absolute inset-y-0 left-1.5 flex items-center text-[12px] text-v2-text-text-faint">
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
                          // Work in progress carries the accent; finished work steps back to grey. Both keep
                          // at least 3:1 against the panel in light and dark.
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
