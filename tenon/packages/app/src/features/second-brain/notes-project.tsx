import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { Reveal, RevealShow } from "@tenon/ui/v2/reveal"
import { TabsV2 } from "@tenon/ui/v2/tabs-v2"
import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { PageEmpty } from "@/components/page"
import type { LogEntry, ProjectRecord, Timeline, TimelineItem, VaultPageInfo } from "./client"
import { monthGrid, shiftMonth, timelineCounts, timelineLayout } from "./notes-timeline"

export const projectTabs = ["timeline", "board", "table", "calendar", "docs", "log", "details"] as const
export type ProjectTab = (typeof projectTabs)[number]

const statuses = ["todo", "doing", "done"] as const
const kinds = ["task", "milestone"] as const
/** The views that list timeline items and so offer "Add item". */
const itemTabs: ReadonlyArray<ProjectTab> = ["timeline", "board", "table"]

type Loaded<T> = { value?: T; loading: boolean; failed: boolean; retry: () => void }

const fieldClass =
  "h-8 min-w-0 rounded-full bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base shadow-[0_0_0_0.5px_var(--v2-border-border-muted)] transition-[background-color,box-shadow] duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none"

const emptyDraft = () => ({
  title: "",
  kind: "task" as TimelineItem["kind"],
  status: "todo" as TimelineItem["status"],
  start: "",
  end: "",
})

/** A Project on the Projects page: title, progress line and the Timeline, Board, Table, Calendar, Docs, Log and Details views. */
export function NotesProject(props: {
  project: ProjectRecord
  tab: ProjectTab
  onTab: (tab: ProjectTab) => void
  timeline: Loaded<Timeline>
  log: Loaded<ReadonlyArray<LogEntry>>
  pages: ReadonlyArray<VaultPageInfo>
  pageHref: (path: string) => string
  onPage: (path: string) => void
  /** Saves the whole item list over the loaded revision; resolves to an error message, or "" when saved. */
  onSaveItems: (items: ReadonlyArray<TimelineItem>) => Promise<string>
  calendarHref: string
  /** The Details tab: the Project's card (outcome, progress, status, Start work). */
  details: JSX.Element
}) {
  const language = useLanguage()
  // The user's own calendar day (grid dates are plain YYYY-MM-DD days), not the UTC one.
  const today = () => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  }
  const [state, setState] = createStore({
    adding: false,
    saving: false,
    error: "",
    draft: emptyDraft(),
    month: today().slice(0, 7),
  })
  const items = () => props.timeline.value?.items ?? []
  const counts = createMemo(() => timelineCounts(items()))
  const dateLabel = (value: string) => {
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
    if (!Number.isFinite(date.getTime())) return ""
    return date.toLocaleDateString(language.intl(), { day: "numeric", month: "short", timeZone: "UTC" })
  }
  const progress = () => {
    const params = {
      percent: Math.round((props.timeline.value?.progress ?? 0) * 100),
      done: counts().done,
      total: counts().total,
    }
    const next = counts().next
    if (!next) return language.t("secondBrain.vault.progress", params)
    return language.t(next.start ? "secondBrain.vault.progressNextDate" : "secondBrain.vault.progressNext", {
      ...params,
      title: next.title,
      date: next.start ? dateLabel(next.start) : "",
    })
  }
  const statusLabel = (status: TimelineItem["status"]) => language.t(`secondBrain.vault.status.${status}`)
  const kindLabel = (kind: TimelineItem["kind"]) =>
    language.t(kind === "task" ? "secondBrain.vault.item.task" : "secondBrain.vault.milestone")

  const save = async (next: ReadonlyArray<TimelineItem>) => {
    if (state.saving) return false
    setState({ saving: true, error: "" })
    const error = await props.onSaveItems(next)
    setState({ saving: false, error })
    return !error
  }
  const add = async (event: SubmitEvent) => {
    event.preventDefault()
    const draft = state.draft
    const title = draft.title.trim()
    if (!title) return setState("error", language.t("secondBrain.vault.item.error.title"))
    const end = draft.kind === "milestone" ? "" : draft.end
    if (draft.start && end && end < draft.start)
      return setState("error", language.t("secondBrain.vault.item.error.dates"))
    const item: TimelineItem = {
      id: `item_${crypto.randomUUID()}`,
      title,
      kind: draft.kind,
      status: draft.status,
      ...(draft.start ? { start: draft.start } : {}),
      ...(end ? { end } : {}),
    }
    if (await save([...items(), item])) setState({ draft: emptyDraft(), adding: false })
  }
  const setStatus = (id: string, status: TimelineItem["status"]) =>
    void save(items().map((item) => (item.id === id ? { ...item, status } : item)))

  // Shared loading and error states for the views that read the timeline or the log.
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

  const milestoneMark = () => (
    <span aria-hidden="true" class="text-v2-text-text-accent">
      ◆
    </span>
  )

  const addForm = () => (
    <Reveal open={state.adding && itemTabs.includes(props.tab)}>
      <form
        class="flex flex-wrap items-center gap-2 rounded-[20px] bg-v2-background-bg-layer-01 p-3"
        onSubmit={(event) => void add(event)}
      >
        <input
          class={`${fieldClass} min-w-[180px] flex-1`}
          aria-label={language.t("secondBrain.vault.item.title")}
          placeholder={language.t("secondBrain.vault.item.title")}
          maxLength={200}
          value={state.draft.title}
          onInput={(event) => setState("draft", "title", event.currentTarget.value)}
        />
        <select
          class={fieldClass}
          aria-label={language.t("secondBrain.vault.item.kind")}
          value={state.draft.kind}
          onChange={(event) => {
            const kind = kinds.find((value) => value === event.currentTarget.value)
            if (kind) setState("draft", "kind", kind)
          }}
        >
          <For each={kinds}>{(kind) => <option value={kind}>{kindLabel(kind)}</option>}</For>
        </select>
        <select
          class={fieldClass}
          aria-label={language.t("secondBrain.vault.table.status")}
          value={state.draft.status}
          onChange={(event) => {
            const status = statuses.find((value) => value === event.currentTarget.value)
            if (status) setState("draft", "status", status)
          }}
        >
          <For each={statuses}>{(status) => <option value={status}>{statusLabel(status)}</option>}</For>
        </select>
        <input
          type="date"
          class={`${fieldClass} tabular-nums`}
          aria-label={language.t("secondBrain.vault.item.start")}
          title={language.t("secondBrain.vault.item.start")}
          value={state.draft.start}
          onInput={(event) => setState("draft", "start", event.currentTarget.value)}
        />
        <Show when={state.draft.kind === "task"}>
          <input
            type="date"
            class={`${fieldClass} tabular-nums`}
            aria-label={language.t("secondBrain.vault.item.end")}
            title={language.t("secondBrain.vault.item.end")}
            min={state.draft.start || undefined}
            value={state.draft.end}
            onInput={(event) => setState("draft", "end", event.currentTarget.value)}
          />
        </Show>
        <span class="flex items-center gap-1">
          <ButtonV2
            size="small"
            variant="ghost"
            type="button"
            onClick={() => setState({ adding: false, error: "", draft: emptyDraft() })}
          >
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 size="small" variant="contrast" type="submit" disabled={state.saving}>
            {state.saving ? language.t("secondBrain.saving") : language.t("secondBrain.vault.item.save")}
          </ButtonV2>
        </span>
      </form>
    </Reveal>
  )

  const weekdays = createMemo(() =>
    // 2026-11-02 is a Monday; the grid starts its weeks on Monday.
    Array.from({ length: 7 }, (_, index) =>
      new Date(Date.UTC(2026, 10, 2 + index)).toLocaleDateString(language.intl(), {
        weekday: "short",
        timeZone: "UTC",
      }),
    ),
  )
  const monthLabel = () =>
    new Date(`${state.month}-01T00:00:00Z`).toLocaleDateString(language.intl(), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })

  return (
    <div class="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 pb-8 pt-8 sm:px-10">
      <h1 class="break-words text-[28px] leading-[38px] text-v2-text-text-base [font-weight:700]">
        {props.project.name}
      </h1>
      <Show when={props.project.outcome}>
        <p class="max-w-3xl text-[15px] leading-6 text-v2-text-text-base">{props.project.outcome}</p>
      </Show>
      <Show when={props.timeline.value}>
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{progress()}</p>
      </Show>
      <TabsV2
        variant="pill"
        value={props.tab}
        onChange={(value) => {
          const next = projectTabs.find((tab) => tab === value)
          if (next) props.onTab(next)
        }}
        class="flex min-h-0 flex-col gap-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          <TabsV2.List aria-label={language.t("secondBrain.vault.views")}>
            <For each={projectTabs}>
              {(tab) => <TabsV2.Trigger value={tab}>{language.t(`secondBrain.vault.tab.${tab}`)}</TabsV2.Trigger>}
            </For>
          </TabsV2.List>
          <Show when={itemTabs.includes(props.tab) && props.timeline.value}>
            <ButtonV2
              size="small"
              variant="ghost"
              icon="plus"
              class="ml-auto"
              aria-expanded={state.adding}
              onClick={() => setState({ adding: !state.adding, error: "" })}
            >
              {language.t("secondBrain.vault.item.add")}
            </ButtonV2>
          </Show>
        </div>
        {addForm()}
        <RevealShow when={state.error}>
          {(error) => (
            <p role="alert" class="px-1 text-[12px] text-v2-text-text-critical">
              {error()}
            </p>
          )}
        </RevealShow>

        <TabsV2.Content value="timeline">
          {loaded(props.timeline, (timeline) => (
            <Show
              when={timeline.items.length > 0}
              fallback={<PageEmpty>{language.t("secondBrain.vault.timeline.empty")}</PageEmpty>}
            >
              <TimelineGrid items={timeline.items} dateLabel={dateLabel} statusLabel={statusLabel} />
            </Show>
          ))}
        </TabsV2.Content>

        <TabsV2.Content value="board">
          {loaded(props.timeline, (timeline) => (
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <For each={statuses}>
                {(status) => {
                  const column = () => timeline.items.filter((item) => item.status === status)
                  return (
                    <section
                      role="group"
                      aria-label={statusLabel(status)}
                      class="flex min-w-0 flex-col gap-2 rounded-[20px] bg-v2-background-bg-layer-01 p-3"
                    >
                      <h2 class="flex items-center gap-2 px-1 text-[12px] text-v2-text-text-muted [font-weight:500]">
                        <span class="min-w-0 flex-1 truncate">{statusLabel(status)}</span>
                        <span class="tabular-nums text-v2-text-text-faint">{column().length}</span>
                      </h2>
                      <For each={column()}>
                        {(item) => (
                          <div class="flex min-w-0 flex-col gap-1 rounded-[14px] bg-v2-background-bg-base px-3 py-2.5 shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]">
                            <span class="flex min-w-0 items-center gap-1.5 text-[13px] text-v2-text-text-base">
                              <Show when={item.kind === "milestone"}>{milestoneMark()}</Show>
                              <span class="min-w-0 truncate">{item.title}</span>
                            </span>
                            <span class="flex min-w-0 items-center gap-2">
                              <span class="min-w-0 flex-1 truncate text-[11px] tabular-nums text-v2-text-text-faint">
                                {[item.start, item.end]
                                  .filter((value): value is string => !!value)
                                  .map(dateLabel)
                                  .join(" – ")}
                              </span>
                              <select
                                class="h-6 shrink-0 rounded-full bg-v2-background-bg-layer-01 px-2 text-[11px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none"
                                aria-label={language.t("secondBrain.vault.item.status", { title: item.title })}
                                value={item.status}
                                disabled={state.saving}
                                onChange={(event) => {
                                  const next = statuses.find((value) => value === event.currentTarget.value)
                                  if (next && next !== item.status) setStatus(item.id, next)
                                }}
                              >
                                <For each={statuses}>
                                  {(value) => <option value={value}>{statusLabel(value)}</option>}
                                </For>
                              </select>
                            </span>
                          </div>
                        )}
                      </For>
                    </section>
                  )
                }}
              </For>
            </div>
          ))}
        </TabsV2.Content>

        <TabsV2.Content value="table">
          {loaded(props.timeline, (timeline) => (
            <Show
              when={timeline.items.length > 0}
              fallback={<PageEmpty>{language.t("secondBrain.vault.table.empty")}</PageEmpty>}
            >
              <div class="overflow-x-auto rounded-[20px] bg-v2-background-bg-layer-01">
                <table class="w-full min-w-[560px] border-collapse text-left text-[13px]">
                  <thead class="text-[12px] text-v2-text-text-muted">
                    <tr>
                      <For each={["title", "status", "start", "end"] as const}>
                        {(column) => (
                          <th scope="col" class="px-4 py-2.5 [font-weight:500]">
                            {language.t(`secondBrain.vault.table.${column}`)}
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={timeline.items}>
                      {(item) => (
                        <tr class="border-t border-v2-border-border-muted text-v2-text-text-base">
                          <td class="px-4 py-2.5">
                            <span class="flex items-center gap-1.5">
                              <Show when={item.kind === "milestone"}>{milestoneMark()}</Show>
                              {item.title}
                            </span>
                          </td>
                          <td class="px-4 py-2.5 text-v2-text-text-muted">{statusLabel(item.status)}</td>
                          <td class="px-4 py-2.5 tabular-nums text-v2-text-text-muted">
                            <time datetime={item.start}>{item.start ? dateLabel(item.start) : ""}</time>
                          </td>
                          <td class="px-4 py-2.5 tabular-nums text-v2-text-text-muted">
                            <time datetime={item.end}>{item.end ? dateLabel(item.end) : ""}</time>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          ))}
        </TabsV2.Content>

        <TabsV2.Content value="calendar">
          {loaded(props.timeline, (timeline) => {
            const grid = createMemo(() => monthGrid(state.month, timeline.items))
            return (
              <div class="flex flex-col gap-2 rounded-[20px] bg-v2-background-bg-layer-01 p-3">
                <div class="flex items-center gap-1 px-1">
                  <h2 class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:500]">
                    {monthLabel()}
                  </h2>
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    class="!size-8"
                    aria-label={language.t("secondBrain.vault.calendar.previous")}
                    icon={<Icon name="chevron-left" size="small" />}
                    onClick={() => setState("month", shiftMonth(state.month, -1))}
                  />
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    class="!size-8"
                    aria-label={language.t("secondBrain.vault.calendar.next")}
                    icon={<Icon name="chevron-right" size="small" />}
                    onClick={() => setState("month", shiftMonth(state.month, 1))}
                  />
                  <a
                    href={props.calendarHref}
                    class="ml-1 rounded-full px-2.5 py-1 text-[12px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
                  >
                    {language.t("secondBrain.vault.calendar.open")}
                  </a>
                </div>
                <div class="grid grid-cols-7 gap-px text-[11px] text-v2-text-text-faint">
                  <For each={weekdays()}>{(name) => <span class="truncate px-1.5 py-1">{name}</span>}</For>
                </div>
                {/* One surface with hairline gaps, like the Calendar page's month view; today gets the accent dot. */}
                <ol class="grid grid-cols-7 gap-px overflow-hidden rounded-[12px] bg-v2-border-border-muted">
                  <For each={grid().flat()}>
                    {(cell) => (
                      <li class="flex min-h-20 min-w-0 flex-col gap-0.5 bg-v2-background-bg-layer-01 p-1.5">
                        <time
                          datetime={cell.date}
                          classList={{
                            "flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums": true,
                            "bg-v2-icon-icon-accent text-v2-icon-icon-contrast [font-weight:600]": cell.date === today(),
                            "text-v2-text-text-muted": cell.inMonth && cell.date !== today(),
                            "text-v2-text-text-faint": !cell.inMonth && cell.date !== today(),
                          }}
                        >
                          {Number(cell.date.slice(8))}
                        </time>
                        <For each={cell.items.slice(0, 3)}>
                          {(item) => (
                            <span
                              title={`${item.title} · ${statusLabel(item.status)}`}
                              classList={{
                                "flex min-w-0 items-center gap-1 truncate rounded-full px-1.5 text-[11px] leading-5": true,
                                "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container":
                                  item.status === "doing",
                                "bg-v2-background-bg-layer-02 text-v2-text-text-base": item.status !== "doing",
                                "line-through": item.status === "done",
                              }}
                            >
                              <Show when={item.kind === "milestone"}>{milestoneMark()}</Show>
                              <span class="min-w-0 truncate">{item.title}</span>
                            </span>
                          )}
                        </For>
                        <Show when={cell.items.length > 3}>
                          <span class="px-1.5 text-[11px] tabular-nums text-v2-text-text-faint">
                            +{cell.items.length - 3}
                          </span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={!grid().some((week) => week.some((cell) => cell.inMonth && cell.items.length > 0))}>
                  <p class="px-1 text-[12px] text-v2-text-text-faint">
                    {language.t("secondBrain.vault.calendar.empty")}
                  </p>
                </Show>
              </div>
            )
          })}
        </TabsV2.Content>

        <TabsV2.Content value="docs">
          <Show
            when={props.pages.length > 0}
            fallback={<PageEmpty>{language.t("secondBrain.vault.docs.empty")}</PageEmpty>}
          >
            <ul class="flex flex-col gap-px">
              <For each={props.pages}>
                {(page) => (
                  <li class="flex min-w-0 items-center gap-3 rounded-[16px] px-3 py-2.5 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none">
                    <a
                      href={props.pageHref(page.path)}
                      class="min-w-0 flex-1 truncate text-[14px] text-v2-text-text-base hover:underline"
                      onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
                        event.preventDefault()
                        props.onPage(page.path)
                      }}
                    >
                      {page.title}
                    </a>
                    {/* A hand-edited `updated_at` may not parse; the server then sends "". */}
                    <Show when={Number.isFinite(Date.parse(page.updatedAt))}>
                      <span class="shrink-0 text-[12px] tabular-nums text-v2-text-text-faint">
                        {dateLabel(new Date(page.updatedAt).toISOString())}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </TabsV2.Content>

        <TabsV2.Content value="log">
          {loaded(props.log, (entries) => (
            <Show
              when={entries.length > 0}
              fallback={<PageEmpty>{language.t("secondBrain.vault.log.empty")}</PageEmpty>}
            >
              <ol class="flex flex-col gap-px">
                <For each={entries}>
                  {(entry) => (
                    <li class="flex min-w-0 items-baseline gap-3 rounded-[16px] px-3 py-2">
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
        </TabsV2.Content>
        <TabsV2.Content value="details">{props.details}</TabsV2.Content>
      </TabsV2>
    </div>
  )
}

/** One row per item over a grid of weeks: a bar from start to end, or ◆ on a milestone's date. */
function TimelineGrid(props: {
  items: ReadonlyArray<TimelineItem>
  dateLabel: (value: string) => string
  statusLabel: (status: TimelineItem["status"]) => string
}) {
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
                        title={`${row.item.title} · ${props.statusLabel(row.item.status)}`}
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
