import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { focusWhenConnected } from "@/utils/focus-when-connected"
import { showToast } from "@/utils/toast"
import type { LogEntry, ProjectRecord, Timeline, TimelineItem, VaultPageInfo } from "./client"
import {
  dueDatePatch,
  milestoneGroups,
  milestoneStatus,
  restoreItem,
  timelineCounts,
  timelineLayout,
  type MilestoneGroup,
} from "./notes-timeline"
import { DateChip, KindSwitch, StatusMenu } from "./project-controls"
import { ProjectActionsMenu, useProjectCard } from "./project-details"
import {
  LogCard,
  loadedView,
  PagesCard,
  ProgressCard,
  ThreadsCard,
  type Loaded,
  type ProjectThread,
} from "./project-rail"

export type { ProjectThread } from "./project-rail"

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

/**
 * A Project as a workspace: a header (title, status, the actions menu and Start work), then tasks on the left,
 * grouped under milestones, and the Project's context on the right (Progress, Pages, Threads, Log). The rail stacks
 * under the tasks below 1100px. Tasks and milestones are the Project's timeline items, saved whole through
 * `onSaveItems`; `settings` (an older link's section) is the Progress card.
 */
export function ProjectView(props: {
  project: ProjectRecord
  /** The workspace the Project's card is saved through. */
  directory: string
  /** After archiving, the page leaves the Project. */
  onArchived: () => void
  timeline: Loaded<Timeline>
  log: Loaded<ReadonlyArray<LogEntry>>
  pages: ReadonlyArray<VaultPageInfo>
  pageHref: (path: string) => string
  onPage: (path: string) => void
  onNewPage: () => void
  creatingPage: boolean
  /** Why the last New page failed. */
  pageError: string
  /** Saves the whole item list over the loaded revision; resolves to an error message, or "" when saved. */
  onSaveItems: (items: ReadonlyArray<TimelineItem>) => Promise<string>
  threads: ReadonlyArray<ProjectThread>
  threadHref: (id: string) => string
  /** Absent when the Project has no folder to run threads in. */
  onNewThread?: () => void
  onStartWork?: () => void
  /** A section to scroll to on open (from an older link or an agent write's Open). */
  section?: ProjectSection
}) {
  const language = useLanguage()
  const card = useProjectCard(props)
  const [state, setState] = createStore({
    show: "open" as "open" | "all",
    saving: false,
    error: "",
    draft: { title: "", kind: "task" as TimelineItem["kind"], date: undefined as string | undefined },
    /** The item whose title is being edited in its row. */
    renaming: "",
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
  // Progress has one source: done of total tasks. The card's stored percent mirrors it, so Home and the Projects
  // lists (which read only the card) agree; the manual slider is used only while the Project has no tasks.
  createEffect(
    on(
      // Only this Project's settled timeline: a reload can still hold the previous Project's items.
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
  // A task's date is its due day (end); a milestone's is its day (start).
  const dueOf = (item: TimelineItem) => (item.kind === "milestone" ? item.start : (item.end ?? item.start))

  const save = async (next: ReadonlyArray<TimelineItem>) => {
    if (state.saving) return false
    setState({ saving: true, error: "" })
    const error = await props.onSaveItems(next)
    setState({ saving: false, error })
    return !error
  }
  // Saves replace the whole list, so every change and Undo starts from the latest items, not a captured array.
  const update = (id: string, patch: Partial<TimelineItem>) =>
    save(items().map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const undoToast = (description: string, undo: () => void) =>
    showToast({ description, actions: [{ label: language.t("secondBrain.sidebar.undo"), onClick: undo }] })
  const setStatus = async (item: TimelineItem, status: TimelineItem["status"]) => {
    const { id, title, status: previous } = item
    if (!(await update(id, { status })) || status !== "done") return
    undoToast(language.t("secondBrain.tasks.completed", { title }), () => void update(id, { status: previous }))
  }
  const remove = async (item: TimelineItem) => {
    const removed = { ...item }
    const index = items().findIndex((entry) => entry.id === item.id)
    if (!(await save(items().filter((entry) => entry.id !== item.id)))) return
    undoToast(language.t("secondBrain.project.itemDeleted", { title: removed.title }), () => {
      void save(restoreItem(items(), removed, index))
    })
  }
  const finishRename = (item: TimelineItem, value: string | undefined) => {
    if (state.renaming !== item.id) return
    setState("renaming", "")
    const title = value?.trim()
    if (title && title !== item.title) void update(item.id, { title })
  }
  // A rename picked from the menu shows its input once the menu has closed: closing returns focus to the trigger.
  let renameFromMenu = ""
  // New items join the end of the list, so a task lands under the last milestone.
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
  createEffect(
    on(
      () => [props.project.id, props.section] as const,
      ([, section]) => {
        if (!section) return
        queueMicrotask(() =>
          document
            .getElementById(`project-${section}`)
            ?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }),
        )
      },
    ),
  )

  /** A task line, or a milestone's heading line with its tasks' "n of m done". */
  const row = (item: TimelineItem, group?: MilestoneGroup) => {
    // A milestone reads as done once every task under it is.
    const status = () => (group && milestoneStatus(group)) || item.status
    return (
      <div
        data-task={item.id}
        data-kind={item.kind}
        data-status={status()}
        classList={{
          "flex items-center gap-3 px-4": true,
          "min-h-11": item.kind === "milestone",
          "min-h-10": item.kind === "task",
        }}
      >
        <Show
          when={item.kind === "task"}
          fallback={
            <span aria-hidden="true" class="flex w-4 shrink-0 justify-center text-v2-icon-icon-accent">
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
            onChange={(checked) => void setStatus(item, checked ? "done" : "todo")}
          />
        </Show>
        <Show
          when={state.renaming === item.id}
          fallback={
            // A button, so rename is one click or Enter away from the keyboard too.
            <button
              type="button"
              title={item.title}
              aria-label={language.t("secondBrain.project.renameItem", { title: item.title })}
              disabled={state.saving}
              classList={{
                "min-w-0 flex-1 truncate rounded-[8px] text-left focus-visible:outline-offset-2": true,
                "type-row-title": item.kind === "milestone",
                "text-[13px]": item.kind === "task",
                "text-v2-text-text-muted line-through": status() === "done",
                "text-v2-text-text-base": status() !== "done",
              }}
              onClick={() => setState("renaming", item.id)}
            >
              {item.title}
            </button>
          }
        >
          <input
            ref={focusWhenConnected}
            class="h-7 min-w-0 flex-1 rounded-full bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_1px_var(--v2-border-border-base)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
            aria-label={language.t("secondBrain.project.renameItem", { title: item.title })}
            maxLength={200}
            value={item.title}
            onKeyDown={(event) => {
              if (event.isComposing) return
              if (event.key === "Enter") finishRename(item, event.currentTarget.value)
              if (event.key === "Escape") finishRename(item, undefined)
            }}
            onBlur={(event) => finishRename(item, event.currentTarget.value)}
          />
        </Show>
        <Show when={group && group.total > 0 ? group : undefined}>
          {(group) => (
            <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">
              {language.t("secondBrain.project.milestoneDone", { done: group().done, total: group().total })}
            </span>
          )}
        </Show>
        <StatusMenu
          value={status()}
          label={language.t("secondBrain.project.statusOf", { title: item.title })}
          disabled={state.saving}
          onChange={(status) => void setStatus(item, status)}
        />
        <DateChip
          value={dueOf(item)?.slice(0, 10)}
          label={language.t("secondBrain.project.dueDateOf", { title: item.title })}
          disabled={state.saving}
          onChange={(date) => void update(item.id, dueDatePatch(item, date))}
        />
        <MenuV2 gutter={4} modal={false} placement="bottom-end">
          <MenuV2.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="small"
            disabled={state.saving}
            icon={<Icon name="outline-dots" size="small" />}
            aria-label={language.t("secondBrain.project.itemActions", { title: item.title })}
          />
          <MenuV2.Portal>
            <MenuV2.Content
              onCloseAutoFocus={() => {
                if (renameFromMenu !== item.id) return
                renameFromMenu = ""
                // Kobalte focuses the trigger right after this handler, so the input opens after it.
                queueMicrotask(() => setState("renaming", item.id))
              }}
            >
              <MenuV2.Item onSelect={() => (renameFromMenu = item.id)}>{language.t("common.rename")}</MenuV2.Item>
              <MenuV2.Item onSelect={() => void remove(item)}>{language.t("common.delete")}</MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    )
  }

  return (
    <div class="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-6 pb-12 pt-6 sm:px-10">
      <header class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="min-w-0 break-words type-page-title text-v2-text-text-base">{props.project.name}</h1>
          <span
            data-project-status={props.project.status}
            class="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-02 px-2.5 type-meta text-v2-text-text-muted"
          >
            <span
              aria-hidden="true"
              classList={{
                "size-1.5 rounded-full": true,
                "bg-v2-icon-icon-accent": props.project.status === "active",
                "bg-v2-icon-icon-muted": props.project.status !== "active",
              }}
            />
            {language.t(`secondBrain.projects.filter.${props.project.status}`)}
          </span>
          <span class="flex-1" />
          <ProjectActionsMenu project={props.project} card={card} />
          <ButtonV2 variant="contrast" disabled={!props.onStartWork} onClick={() => props.onStartWork?.()}>
            {language.t("secondBrain.projects.startWork")}
          </ButtonV2>
        </div>
        <Show when={outcome() && outcome() !== props.project.name.trim()}>
          <p class="max-w-3xl type-body text-v2-text-text-muted">{outcome()}</p>
        </Show>
      </header>

      <div class="grid grid-cols-1 gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_300px] min-[1100px]:items-start">
        <section
          id="project-tasks"
          aria-labelledby="project-tasks-title"
          class="flex min-w-0 scroll-mt-6 flex-col gap-3"
        >
          <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="project-tasks-title" class="type-section text-v2-text-text-base">
              {language.t("secondBrain.project.tasks")}
            </h2>
            <Show when={props.timeline.value}>
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
              <SegmentedControlItemV2 value="all">{language.t("secondBrain.project.show.all")}</SegmentedControlItemV2>
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
                    <Show when={group.milestone}>{(milestone) => row(milestone(), group)}</Show>
                    <Show when={group.tasks.length > 0}>
                      <ul class="flex flex-col divide-y divide-v2-border-border-muted">
                        <For each={group.tasks}>{(task) => <li>{row(task)}</li>}</For>
                      </ul>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          ))}
          <RevealShow when={state.error}>
            {(error) => (
              <p role="alert" class="px-1 type-caption text-v2-text-text-critical">
                {error()}
              </p>
            )}
          </RevealShow>
          <Show when={items().some((item) => item.start || item.end)}>
            {/* Open hides done tasks here too, like the list above. */}
            <TimelineGrid
              items={items().filter(
                (item) => state.show === "all" || item.kind === "milestone" || item.status !== "done",
              )}
              dateLabel={shortDate}
            />
          </Show>
        </section>

        <aside class="flex min-w-0 flex-col gap-3" aria-label={language.t("secondBrain.project.context")}>
          <ProgressCard card={card} tasks={counts().percent === undefined ? undefined : counts()} />
          <PagesCard
            pages={props.pages}
            pageHref={props.pageHref}
            onPage={props.onPage}
            onNewPage={props.onNewPage}
            creatingPage={props.creatingPage}
            pageError={props.pageError}
            dateLabel={shortDate}
          />
          <ThreadsCard threads={props.threads} threadHref={props.threadHref} onNewThread={props.onNewThread} />
          <LogCard log={props.log} />
        </aside>
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
