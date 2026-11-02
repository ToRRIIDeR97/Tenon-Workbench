import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { TabsV2 } from "@tenon/ui/v2/tabs-v2"
import { createMemo, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { PageEmpty } from "@/components/page"
import type { LogEntry, ProjectRecord, Timeline, TimelineItem, VaultPageInfo } from "./client"
import { timelineCounts, timelineLayout } from "./notes-timeline"

export const projectTabs = ["timeline", "board", "table", "docs", "log"] as const
export type ProjectTab = (typeof projectTabs)[number]

const statuses = ["todo", "doing", "done"] as const

type Loaded<T> = { value?: T; loading: boolean; failed: boolean; retry: () => void }

/** A Project in Notes: title, progress line and the Timeline, Board, Table, Docs and Log views. */
export function NotesProject(props: {
  project: ProjectRecord
  tab: ProjectTab
  onTab: (tab: ProjectTab) => void
  timeline: Loaded<Timeline>
  log: Loaded<ReadonlyArray<LogEntry>>
  pages: ReadonlyArray<VaultPageInfo>
  pageHref: (path: string) => string
  onPage: (path: string) => void
}) {
  const language = useLanguage()
  const items = () => props.timeline.value?.items ?? []
  const counts = createMemo(() => timelineCounts(items()))
  const dateLabel = (value: string) =>
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(language.intl(), {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    })
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

  return (
    <div class="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 pb-8 pt-8 sm:px-10">
      <h1 class="break-words text-[28px] leading-[38px] text-v2-text-text-base [font-weight:700]">
        {props.project.name}
      </h1>
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
        <TabsV2.List aria-label={language.t("secondBrain.vault.views")}>
          <For each={projectTabs}>
            {(tab) => <TabsV2.Trigger value={tab}>{language.t(`secondBrain.vault.tab.${tab}`)}</TabsV2.Trigger>}
          </For>
        </TabsV2.List>

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
                          <div class="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-v2-background-bg-base px-3 py-2.5 shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]">
                            <span class="flex min-w-0 items-center gap-1.5 text-[13px] text-v2-text-text-base">
                              <Show when={item.kind === "milestone"}>
                                <span aria-hidden="true" class="text-v2-text-text-accent">
                                  ◆
                                </span>
                              </Show>
                              <span class="min-w-0 truncate">{item.title}</span>
                            </span>
                            <Show when={item.start || item.end}>
                              <span class="text-[11px] tabular-nums text-v2-text-text-faint">
                                {[item.start, item.end]
                                  .filter((value): value is string => !!value)
                                  .map(dateLabel)
                                  .join(" – ")}
                              </span>
                            </Show>
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
                            <Show when={item.kind === "milestone"}>
                              <span aria-hidden="true" class="text-v2-text-text-accent">
                                ◆
                              </span>
                            </Show>
                            {item.title}
                          </span>
                        </td>
                        <td class="px-4 py-2.5 text-v2-text-text-muted">{statusLabel(item.status)}</td>
                        <td class="px-4 py-2.5 tabular-nums text-v2-text-text-muted">{item.start ?? ""}</td>
                        <td class="px-4 py-2.5 tabular-nums text-v2-text-text-muted">{item.end ?? ""}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          ))}
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
                    <Show when={page.updatedAt}>
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
                      <time datetime={entry.at} class="w-32 shrink-0 text-[12px] tabular-nums text-v2-text-text-faint">
                        {new Date(entry.at).toLocaleString(language.intl(), {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <span class="w-20 shrink-0 truncate text-[12px] text-v2-text-text-muted">{entry.author}</span>
                      <span class="min-w-0 flex-1 text-[13px] text-v2-text-text-base">{entry.text}</span>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          ))}
        </TabsV2.Content>
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
