import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { parseISODate } from "@/utils/date"
import { getRelativeTime } from "@/utils/time"
import type { ProjectRecord, Timeline, TimelineItem } from "./client"
import { timelineCounts } from "./notes-timeline"
import { ProjectActionsMenu, useProjectCard } from "./project-details"
import { previewSummary } from "./project-preview-model"
import { createProjectTasks, ProjectTaskRow } from "./project-tasks"
import { ProjectStatusChip } from "./project-view"

export function ProjectDetail(props: {
  project: ProjectRecord
  directory: string
  timeline?: Timeline
  loading: boolean
  onSaveItems: (items: ReadonlyArray<TimelineItem>) => Promise<string>
  pages: number
  threads: number
  onOpen: () => void
  onStartWork?: () => void
  onArchived: () => void
}) {
  const language = useLanguage()
  const card = useProjectCard(props)
  const items = () => (props.timeline?.projectId === props.project.id ? props.timeline.items : [])
  const tasks = createProjectTasks({ items, onSaveItems: props.onSaveItems })
  const summary = createMemo(() => previewSummary(props.project, items()))
  const counts = createMemo(() => timelineCounts(items()))
  const percent = () => counts().percent ?? props.project.progressPercent
  createEffect(
    on(
      () => [props.loading || !props.timeline ? undefined : counts().percent, props.project.progressPercent] as const,
      ([computed, stored]) => {
        if (computed === undefined || computed === stored) return
        void card.syncProgress(computed)
      },
    ),
  )
  const day = (iso: string | undefined) => {
    const time = parseISODate(iso)
    if (Number.isNaN(time)) return undefined
    return new Intl.DateTimeFormat(language.locale(), { month: "short", day: "numeric" }).format(time)
  }
  const outcome = () => props.project.outcome.trim()
  const meta = () =>
    [
      language.plural("secondBrain.projects.detail.pages", props.pages, {
        count: props.pages.toLocaleString(language.intl()),
      }),
      language.plural("secondBrain.projects.detail.threads", props.threads, {
        count: props.threads.toLocaleString(language.intl()),
      }),
      language.t("secondBrain.projects.detail.updated", {
        time: getRelativeTime(props.project.updatedAt, language.t),
      }),
    ].join(" · ")

  return (
    <section
      aria-label={language.t("secondBrain.projects.preview.label", { name: props.project.name })}
      data-project-detail={props.project.id}
      class="flex flex-col"
    >
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="break-words text-[20px] leading-7 text-v2-text-text-base [font-weight:600]">
            {props.project.name}
          </h2>
          <Show when={outcome() && outcome() !== props.project.name.trim()}>
            <p class="mt-0.5 type-body text-v2-text-text-muted">{outcome()}</p>
          </Show>
        </div>
        <ProjectActionsMenu project={props.project} card={card} />
        <ButtonV2 variant="contrast" disabled={!props.onStartWork} onClick={() => props.onStartWork?.()}>
          {language.t("secondBrain.projects.startWork")}
        </ButtonV2>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <ProjectStatusChip status={props.project.status} />
        <span class="type-meta tabular-nums text-v2-text-text-muted">
          {counts().total > 0
            ? language.t("secondBrain.projects.detail.progress", {
                percent: percent(),
                done: counts().done,
                total: counts().total,
              })
            : `${percent()}%`}
        </span>
        <span class="flex-1" />
        <ButtonV2 variant="neutral" onClick={() => props.onOpen()}>
          {language.t("secondBrain.projects.preview.open")}
        </ButtonV2>
      </div>
      <div class="mt-3 h-1 overflow-hidden rounded-full bg-v2-background-bg-layer-03" aria-hidden="true">
        <span
          class="block h-full rounded-full bg-v2-background-bg-accent transition-[width] duration-long ease-emphasized-decelerate motion-reduce:transition-none"
          style={{ width: `${percent()}%` }}
        />
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Show when={summary().next}>
          {(next) => (
            <p class="min-w-0 type-meta text-v2-text-text-base">
              {day(next().date)
                ? language.t("secondBrain.projects.detail.nextMilestoneDue", {
                    title: next().title,
                    date: day(next().date) ?? "",
                  })
                : language.t("secondBrain.projects.detail.nextMilestone", { title: next().title })}
            </p>
          )}
        </Show>
        <Show when={props.project.blocker?.trim()}>
          {(blocker) => (
            <p class="flex min-w-0 max-w-full items-start gap-1.5 rounded-[10px] bg-v2-background-bg-layer-02 px-2.5 py-1 type-meta text-v2-text-text-base">
              <Icon name="warning" size="small" class="mt-px shrink-0 text-v2-state-fg-warning" />
              <span class="min-w-0 break-words">
                {language.t("secondBrain.projects.blocker")}: {blocker()}
              </span>
            </p>
          )}
        </Show>
        <span class="flex-1" />
        <p class="shrink-0 whitespace-nowrap type-meta text-v2-text-text-muted">{meta()}</p>
      </div>

      <div class="mt-5 flex min-w-0 flex-col gap-2">
        <h3 class="type-caption text-v2-text-text-muted">{language.t("secondBrain.projects.preview.openTasks")}</h3>
        <div class="flex flex-col divide-y divide-v2-border-border-muted rounded-[16px] bg-v2-background-bg-base py-1 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
          <Show
            when={summary().open.length > 0}
            fallback={
              <p class="px-4 py-2.5 type-meta text-v2-text-text-muted">
                {props.loading ? language.t("common.loading") : language.t("secondBrain.projects.detail.nothingOpen")}
              </p>
            }
          >
            <For each={summary().open}>{(task) => <ProjectTaskRow tasks={tasks} item={task} />}</For>
          </Show>
        </div>
        <RevealShow when={tasks.state.error}>
          {(error) => (
            <p role="alert" class="px-1 type-caption text-v2-text-text-critical">
              {error()}
            </p>
          )}
        </RevealShow>
      </div>
    </section>
  )
}
