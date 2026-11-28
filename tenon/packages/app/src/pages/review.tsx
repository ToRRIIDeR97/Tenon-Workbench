import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { createMemo, createResource, For, Show, type JSX } from "solid-js"
import { PageEmpty, PageFrame, PageHeader, pageDashboardColumnClass } from "@/components/page"
import { listRowClass } from "@/components/surface-classes"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { listVaultPages, readCalendar } from "@/features/second-brain/client"
import { weeklyReview, type ReviewThread } from "@/features/second-brain/weekly-review"
import { localDate } from "@/features/second-brain/templates"
import { normalizeSessionInfo } from "@/utils/session"
import { sessionHref } from "@/utils/session-route"

const THREAD_LIMIT = 200

function folderOwner(directory: string, folders: ReadonlyArray<{ id: string; folder: string }>) {
  const fold = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  const target = fold(directory)
  return folders
    .filter((item) => {
      const folder = fold(item.folder)
      return target === folder || target.startsWith(`${folder}/`)
    })
    .sort((left, right) => right.folder.length - left.folder.length)[0]?.id
}

export default function ReviewPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const brainProjects = useBrainProjects()
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })

  const [data, { refetch }] = createResource(
    () => layout.home.workspace() ?? undefined,
    async (directory) => {
      const [calendar, pages, sessions] = await Promise.all([
        readCalendar(client(directory)),
        listVaultPages(client(directory)).catch(() => []),
        serverSDK()
          .api.session.list({ parentID: null, limit: THREAD_LIMIT })
          .then((result) => result.data.map(normalizeSessionInfo))
          .catch(() => []),
      ])
      return { calendar, pages, sessions }
    },
  )

  const review = createMemo(() => {
    const value = data.latest
    if (!value) return undefined
    const entries = brainProjects.entries() ?? []
    const folders = entries.map((entry) => ({ id: entry.project.id, folder: entry.threadDirectory }))
    const threads: ReviewThread[] = value.sessions
      .filter((session) => !session.time.archived)
      .map((session) => ({
        id: session.id,
        title: session.title || language.t("secondBrain.project.untitledThread"),
        updated: session.time.updated,
        projectId: folderOwner(session.directory, folders),
      }))
    return weeklyReview({
      now: new Date(),
      tasks: value.calendar.tasks,
      events: value.calendar.events,
      threads,
      projects: entries.map((entry) => entry.project),
      pages: value.pages,
    })
  })
  const projectName = (id: string | undefined) =>
    id
      ? (brainProjects.list()?.find((project) => project.id === id)?.name ?? id)
      : language.t("secondBrain.review.general")
  const day = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(language.intl(), {
      weekday: "short",
      month: "short",
      day: "numeric",
    })

  const section = (title: string, count: number, empty: string, body: () => JSX.Element) => (
    <section class="flex flex-col gap-2" aria-label={title}>
      <h2 class="flex items-baseline gap-2 type-label text-v2-text-text-base">
        {title}
        <span class="type-meta tabular-nums text-v2-text-text-muted">{count}</span>
      </h2>
      <Show when={count > 0} fallback={<p class="type-meta text-v2-text-text-muted">{empty}</p>}>
        {body()}
      </Show>
    </section>
  )
  const row = (title: string, detail: string | undefined, onClick: () => void) => (
    <li>
      <button type="button" class={listRowClass} onClick={onClick}>
        <span class="min-w-0 flex-1 truncate">{title}</span>
        <Show when={detail}>
          <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">{detail}</span>
        </Show>
      </button>
    </li>
  )
  const list = (children: JSX.Element) => <ul class="-mx-3 m-0 flex list-none flex-col gap-0.5 p-0">{children}</ul>

  return (
    <PageFrame labelledBy="review-title" class="@container">
      <PageHeader
        id="review-title"
        column="dashboard"
        title={language.t("secondBrain.review.title")}
        actions={
          <ButtonV2 variant="ghost" icon="refresh" onClick={() => void refetch()}>
            {language.t("secondBrain.review.refresh")}
          </ButtonV2>
        }
      />
      <div class={`${pageDashboardColumnClass} flex flex-col gap-8 pb-10`}>
        <Show
          when={!data.error}
          fallback={
            <PageEmpty
              error
              action={
                <ButtonV2 size="small" variant="outline" onClick={() => void refetch()}>
                  {language.t("secondBrain.error.retry")}
                </ButtonV2>
              }
            >
              {language.t("common.requestFailed")}
            </PageEmpty>
          }
        >
          <Show
            when={review()}
            fallback={
              <Show
                when={layout.home.workspace()}
                fallback={<PageEmpty>{language.t("secondBrain.review.noWorkspace")}</PageEmpty>}
              >
                <PageEmpty loading>{language.t("common.loading")}</PageEmpty>
              </Show>
            }
          >
            {(value) => (
              <div class="grid grid-cols-1 gap-8 @min-[860px]:grid-cols-2">
                {section(
                  language.t("secondBrain.review.completed"),
                  value().completed.length,
                  language.t("secondBrain.review.completed.empty"),
                  () =>
                    list(
                      <For each={value().completed}>
                        {(task) =>
                          row(
                            task.title,
                            task.completedAt ? day(localDate(new Date(task.completedAt))) : undefined,
                            () => navigate(`/calendar?task=${encodeURIComponent(task.id)}`),
                          )
                        }
                      </For>,
                    ),
                )}
                {section(
                  language.t("secondBrain.review.overdue"),
                  value().overdue.length,
                  language.t("secondBrain.review.overdue.empty"),
                  () =>
                    list(
                      <For each={value().overdue}>
                        {(task) =>
                          row(task.title, task.dueDate ? day(task.dueDate) : undefined, () =>
                            navigate(`/calendar?task=${encodeURIComponent(task.id)}`),
                          )
                        }
                      </For>,
                    ),
                )}
                {section(
                  language.t("secondBrain.review.upcoming"),
                  value().upcoming.length,
                  language.t("secondBrain.review.upcoming.empty"),
                  () =>
                    list(
                      <For each={value().upcoming}>
                        {(item) =>
                          row(item.title, `${day(item.date)}${item.time ? ` ${item.time}` : ""}`, () =>
                            navigate(
                              item.kind === "event"
                                ? `/calendar?event=${encodeURIComponent(item.id)}&date=${item.date}`
                                : `/calendar?task=${encodeURIComponent(item.id)}`,
                            ),
                          )
                        }
                      </For>,
                    ),
                )}
                {section(
                  language.t("secondBrain.review.stalled"),
                  value().stalled.length,
                  language.t("secondBrain.review.stalled.empty"),
                  () =>
                    list(
                      <For each={value().stalled}>
                        {(project) =>
                          row(project.name, undefined, () =>
                            navigate(`/projects?project=${encodeURIComponent(project.id)}`),
                          )
                        }
                      </For>,
                    ),
                )}
                {section(
                  language.t("secondBrain.review.threads"),
                  value().threads.reduce((total, group) => total + group.threads.length, 0),
                  language.t("secondBrain.review.threads.empty"),
                  () => (
                    <div class="flex flex-col gap-4">
                      <For each={value().threads}>
                        {(group) => (
                          <div class="flex flex-col gap-1">
                            <h3 class="type-meta text-v2-text-text-muted">{projectName(group.projectId)}</h3>
                            {list(
                              <For each={group.threads}>
                                {(thread) =>
                                  row(thread.title, day(localDate(new Date(thread.updated))), () =>
                                    navigate(sessionHref(server.key, thread.id)),
                                  )
                                }
                              </For>,
                            )}
                          </div>
                        )}
                      </For>
                    </div>
                  ),
                )}
                {section(
                  language.t("secondBrain.review.pages"),
                  value().pages.length,
                  language.t("secondBrain.review.pages.empty"),
                  () =>
                    list(
                      <For each={value().pages}>
                        {(page) =>
                          row(page.title, day(localDate(new Date(page.updatedAt))), () =>
                            navigate(`/projects?page=${encodeURIComponent(page.path)}`),
                          )
                        }
                      </For>,
                    ),
                )}
              </div>
            )}
          </Show>
        </Show>
      </div>
    </PageFrame>
  )
}
