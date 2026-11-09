import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame, PageHeader, pageRowClass, pageWideColumnClass } from "@/components/page"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { localDateKey } from "@/features/second-brain/calendar-domain"
import { createCalendarResource } from "@/features/second-brain/calendar-cache"
import { vaultPageSummary } from "@/features/second-brain/client"
import {
  filterProjectOverview,
  groupProjectOverview,
  type OverviewGroup,
} from "@/features/second-brain/project-overview"
import { useVaultPages } from "@/features/second-brain/vault-pages"

const preview = 5
const statusKey = {
  active: "secondBrain.projects.filter.active",
  paused: "secondBrain.projects.filter.paused",
  archived: "secondBrain.projects.filter.archived",
} as const

/** Every Project's upcoming work and recent notes on one page, for the workspace the sidebar has selected. */
export default function ProjectOverviewPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const navigate = useNavigate()
  const command = useCommand()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore({ filter: "" })
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })

  // The sidebar workspace switcher owns this choice; every read below follows it. All three are shared and
  // cached, so a revisit paints at once.
  const brainDirectory = () => layout.home.workspace() ?? ""
  const source = () => brainDirectory() || undefined
  const projects = useBrainProjects()
  const vault = useVaultPages(source)
  const calendar = createCalendarResource(source, client)

  // With no workspace nothing loads, and the calendar has no snapshot to wait for.
  const loading = () => !!source() && (projects.loading() || vault.loading() || calendar.loading())
  // A failed calendar refresh keeps its last snapshot, which is still worth showing.
  const calendarFailed = () => !calendar.snapshot() && !!calendar.error()
  const failed = () => projects.failed() || !!vault.error() || calendarFailed()
  const retry = () => {
    if (projects.failed()) projects.retry()
    if (vault.error()) vault.retry()
    if (calendarFailed()) void calendar.refetch()
  }
  const groups = createMemo(() =>
    loading() || failed()
      ? []
      : groupProjectOverview({
          projects: projects.list() ?? [],
          notes: (vault.pages() ?? []).map(vaultPageSummary),
          calendar: calendar.snapshot(),
          today: localDateKey(new Date()),
        }),
  )
  const progress = createMemo(
    () => new Map((projects.list() ?? []).map((project) => [project.id, project.progressPercent])),
  )
  const visible = createMemo(() => filterProjectOverview(groups(), state.filter))

  const dateFormat = createMemo(() => new Intl.DateTimeFormat(language.locale(), { month: "short", day: "numeric" }))
  // Calendar dates are local `YYYY-MM-DD` keys; noon keeps them on the same day in every time zone.
  const formatDate = (date: string) => {
    const [year, month, day] = date.split("-").map(Number)
    if (!year || !month || !day) return date
    return dateFormat().format(new Date(year, month - 1, day, 12))
  }
  const projectQuery = (group: OverviewGroup) =>
    group.projectId ? `project=${encodeURIComponent(group.projectId)}` : ""
  const openNote = (path: string) => navigate(`/projects?page=${encodeURIComponent(path)}`)
  const openAll = (page: "notes" | "calendar", group: OverviewGroup) =>
    navigate(group.projectId ? `/${page}?${projectQuery(group)}` : `/${page}`)

  return (
    <PageFrame labelledBy="project-overview-title">
      <Show
        when={brainDirectory()}
        fallback={
          <>
            <PageHeader id="project-overview-title" title={language.t("secondBrain.projects.overview.title")} />
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
          </>
        }
      >
        <PageHeader
          id="project-overview-title"
          title={language.t("secondBrain.projects.overview.title")}
          back={{ label: language.t("secondBrain.projects.back"), onClick: () => navigate("/projects") }}
        />
        <div class={pageWideColumnClass}>
          <label class="relative block">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" />
            </span>
            <input
              class="h-9 w-full rounded-full bg-v2-background-bg-layer-01 pl-9 pr-3 text-[13px] text-v2-text-text-base outline-none transition-[background-color,box-shadow] duration-short ease-standard [box-shadow:inset_0_0_0_1px_var(--v2-border-border-base)] placeholder:text-v2-text-text-faint focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
              aria-label={language.t("secondBrain.projects.overview.filter")}
              placeholder={language.t("secondBrain.projects.overview.filter")}
              value={state.filter}
              onInput={(event) => setState("filter", event.currentTarget.value)}
            />
          </label>
          <Show
            when={!loading()}
            fallback={<p class="px-3 py-2 type-control text-v2-text-text-muted">{language.t("common.loading")}</p>}
          >
            <Show
              when={!failed()}
              fallback={
                <PageEmpty
                  error
                  title={language.t("secondBrain.state.error.title")}
                  action={
                    <ButtonV2 variant="outline" onClick={retry}>
                      {language.t("secondBrain.state.retry")}
                    </ButtonV2>
                  }
                >
                  {language.t("secondBrain.state.error.body")}
                </PageEmpty>
              }
            >
              <Show
                when={visible().length > 0}
                fallback={
                  <PageEmpty>
                    {language.t(
                      groups().length > 0
                        ? "secondBrain.projects.overview.noMatches"
                        : "secondBrain.projects.overview.empty",
                    )}
                  </PageEmpty>
                }
              >
                <For each={visible()}>
                  {(group, index) => {
                    const heading = () => `project-overview-group-${index()}`
                    return (
                      <section class="flex flex-col gap-3" aria-labelledby={heading()}>
                        <div class="flex min-w-0 items-baseline gap-2 px-3">
                          <h2 id={heading()} class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
                            {group.name || language.t("secondBrain.projects.overview.workspace")}
                          </h2>
                          <Show when={group.status}>
                            {(status) => (
                              <span class="shrink-0 type-meta text-v2-text-text-muted">
                                {language.t(statusKey[status()])}
                              </span>
                            )}
                          </Show>
                          <Show when={group.projectId}>
                            {(id) => (
                              <span class="w-10 shrink-0 text-right type-meta tabular-nums text-v2-text-text-muted">
                                {progress().get(id()) ?? 0}%
                              </span>
                            )}
                          </Show>
                        </div>
                        <Show when={group.nextMilestone}>
                          {(milestone) => (
                            <div class="px-3">
                              <p class="type-meta text-v2-text-text-muted">
                                {language.t("secondBrain.projects.nextMilestone")}
                              </p>
                              <p class="mt-1 text-[13px] leading-5 text-v2-text-text-base">{milestone()}</p>
                            </div>
                          )}
                        </Show>
                        <Show when={group.items.length === 0 && group.notes.length === 0}>
                          <p class="px-3 type-control text-v2-text-text-muted">
                            {language.t("secondBrain.projects.overview.nothing")}
                          </p>
                        </Show>
                        <Show when={group.items.length > 0}>
                          <div class="flex flex-col gap-1">
                            <div class="flex h-8 items-center gap-1 pl-3">
                              <h3 class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
                                {language.t("secondBrain.projects.overview.upcoming")}
                              </h3>
                              <Show when={group.items.length > preview}>
                                <ButtonV2 variant="ghost" size="small" onClick={() => openAll("calendar", group)}>
                                  {language.t("secondBrain.projects.overview.showAll")}
                                </ButtonV2>
                              </Show>
                            </div>
                            <ul class="flex flex-col gap-0.5">
                              <For each={group.items.slice(0, preview)}>
                                {(item) => (
                                  <li class="grid min-h-10 grid-cols-[100px_minmax(0,1fr)] items-center gap-3 rounded-[12px] px-3">
                                    <span class="type-meta tabular-nums text-v2-text-text-muted">
                                      {item.date ? formatDate(item.date) : language.t("secondBrain.tasks.unscheduled")}
                                    </span>
                                    <span class="truncate type-row-title text-v2-text-text-base">{item.title}</span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                        <Show when={group.notes.length > 0}>
                          <div class="flex flex-col gap-1">
                            <div class="flex h-8 items-center gap-1 pl-3">
                              <h3 class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
                                {language.t("secondBrain.projects.overview.notes")}
                              </h3>
                              <Show when={group.notes.length > preview}>
                                <ButtonV2 variant="ghost" size="small" onClick={() => openAll("notes", group)}>
                                  {language.t("secondBrain.projects.overview.showAll")}
                                </ButtonV2>
                              </Show>
                            </div>
                            <ul class="flex flex-col gap-0.5">
                              <For each={group.notes.slice(0, preview)}>
                                {(note) => (
                                  <li>
                                    <button type="button" class={pageRowClass} onClick={() => openNote(note.path)}>
                                      <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                                        {note.title}
                                      </span>
                                    </button>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                      </section>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </PageFrame>
  )
}
