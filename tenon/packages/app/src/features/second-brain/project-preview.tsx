import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { parseISODate } from "@/utils/date"
import { getRelativeTime } from "@/utils/time"
import type { ProjectRecord, TimelineItem, VaultPageInfo } from "./client"
import { previewSummary } from "./project-preview-model"
import type { ProjectThread } from "./project-rail"

const RING = 2 * Math.PI * 22
const rowClass =
  "flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-[12px] px-3 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"

/**
 * The selected Project on the Projects page, beside the list: its progress, next milestone, open tasks, recent
 * threads and pages, with Start work and Open project. Read-only: tasks are checked off in the Project itself.
 */
export function ProjectPreview(props: {
  project: ProjectRecord
  items?: ReadonlyArray<TimelineItem>
  loading: boolean
  threads: ReadonlyArray<ProjectThread>
  pages: ReadonlyArray<VaultPageInfo>
  threadHref: (id: string) => string
  onOpen: () => void
  onPage: (path: string) => void
  onStartWork?: () => void
}) {
  const language = useLanguage()
  const summary = () => previewSummary(props.project, props.items ?? [])
  const day = (iso: string | undefined) => {
    const time = parseISODate(iso)
    if (Number.isNaN(time)) return undefined
    return new Intl.DateTimeFormat(language.locale(), { month: "short", day: "numeric" }).format(time)
  }
  return (
    <section
      aria-label={language.t("secondBrain.projects.preview.label", { name: props.project.name })}
      class="flex max-w-[720px] flex-col gap-5 px-8 py-6"
    >
      <header class="flex items-center gap-4">
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true" class="shrink-0 -rotate-90">
          <circle cx="26" cy="26" r="22" fill="none" stroke-width="4" class="stroke-v2-background-bg-layer-03" />
          <circle
            cx="26"
            cy="26"
            r="22"
            fill="none"
            stroke-width="4"
            stroke-linecap="round"
            class="stroke-v2-text-text-base transition-[stroke-dashoffset] duration-long ease-emphasized-decelerate motion-reduce:transition-none"
            stroke-dasharray={String(RING)}
            stroke-dashoffset={String(RING * (1 - Math.min(100, Math.max(0, props.project.progressPercent)) / 100))}
          />
        </svg>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-[18px] leading-6 text-v2-text-text-base [font-weight:600]">{props.project.name}</h2>
          <p class="truncate type-meta text-v2-text-text-muted">{props.project.outcome}</p>
        </div>
        <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">{props.project.progressPercent}%</span>
      </header>

      <Show when={summary().next}>
        {(next) => (
          <div class="flex items-center gap-3 rounded-[20px] bg-v2-background-bg-layer-01 px-4 py-3 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
            <div class="min-w-0 flex-1">
              <p class="type-caption text-v2-text-text-muted">{language.t("secondBrain.projects.nextMilestone")}</p>
              <p class="truncate type-row-title text-v2-text-text-base">{next().title}</p>
            </div>
            <Show when={day(next().date)}>
              {(date) => (
                <span class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-2.5 py-0.5 type-caption text-v2-text-text-muted">
                  {date()}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.project.blocker?.trim()}>
        {(blocker) => (
          <p class="-mt-2 flex items-center gap-2 px-1 type-meta text-v2-text-text-muted">
            <Icon name="warning" size="small" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">
              {language.t("secondBrain.projects.blocker")}: {blocker()}
            </span>
          </p>
        )}
      </Show>

      <div class="flex flex-col gap-1">
        <h3 class="flex items-center gap-2 px-3 type-section text-v2-text-text-base">
          <span class="flex-1">{language.t("secondBrain.projects.preview.openTasks")}</span>
          <Show when={summary().total > 0}>
            <span class="type-caption text-v2-text-text-muted">
              {language.t("secondBrain.project.milestoneDone", { done: summary().done, total: summary().total })}
            </span>
          </Show>
        </h3>
        <Show
          when={summary().open.length > 0}
          fallback={
            <p class="px-3 py-1.5 type-meta text-v2-text-text-muted">
              {props.loading ? language.t("common.loading") : language.t("secondBrain.projects.preview.noTasks")}
            </p>
          }
        >
          <ul class="flex flex-col">
            <For each={summary().open}>
              {(task) => (
                <li class="flex min-h-9 items-center gap-2.5 px-3">
                  <span
                    aria-hidden="true"
                    classList={{
                      "size-3.5 shrink-0 rounded-full": true,
                      "shadow-[inset_0_0_0_1.5px_var(--v2-icon-icon-muted)]": task.status === "todo",
                      "shadow-[inset_0_0_0_4px_var(--v2-icon-icon-accent)]": task.status === "doing",
                    }}
                  />
                  <span class="min-w-0 flex-1 truncate type-meta text-v2-text-text-base">{task.title}</span>
                  <Show when={day(task.end)}>
                    {(date) => <span class="shrink-0 type-caption text-v2-text-text-muted">{date()}</span>}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <Show when={props.threads.length > 0}>
        <div class="flex flex-col gap-1">
          <h3 class="px-3 type-section text-v2-text-text-base">{language.t("secondBrain.projects.preview.threads")}</h3>
          <ul class="flex flex-col">
            <For each={props.threads.slice(0, 3)}>
              {(thread) => (
                <li>
                  <a href={props.threadHref(thread.id)} class={rowClass}>
                    <span
                      aria-hidden="true"
                      classList={{
                        "size-1.5 shrink-0 rounded-full": true,
                        "bg-v2-icon-icon-accent running-pulse": thread.running,
                        "bg-v2-background-bg-layer-03": !thread.running,
                      }}
                    />
                    <span class="min-w-0 flex-1 truncate type-meta text-v2-text-text-base">{thread.title}</span>
                    <span class="shrink-0 type-caption text-v2-text-text-muted">
                      {getRelativeTime(new Date(thread.updated).toISOString(), language.t)}
                    </span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={props.pages.length > 0}>
        <div class="flex flex-col gap-1">
          <h3 class="px-3 type-section text-v2-text-text-base">{language.t("secondBrain.project.pages")}</h3>
          <ul class="flex flex-col">
            <For each={props.pages.slice(0, 3)}>
              {(page) => (
                <li>
                  <button type="button" class={rowClass} onClick={() => props.onPage(page.path)}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                      class="shrink-0 text-v2-icon-icon-muted"
                    >
                      <path d="M4 1.5h5.5L12.5 4.5v10H4z" stroke="currentColor" />
                    </svg>
                    <span class="min-w-0 flex-1 truncate type-meta text-v2-text-text-base">{page.title}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <div class="flex gap-2">
        <ButtonV2 variant="contrast" disabled={!props.onStartWork} onClick={() => props.onStartWork?.()}>
          {language.t("secondBrain.projects.startWork")}
        </ButtonV2>
        <ButtonV2 variant="neutral" onClick={() => props.onOpen()}>
          {language.t("secondBrain.projects.preview.open")}
        </ButtonV2>
      </div>
    </section>
  )
}
