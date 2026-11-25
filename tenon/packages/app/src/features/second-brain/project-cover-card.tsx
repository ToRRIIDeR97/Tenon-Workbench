import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { ProjectRecord } from "./client"
import { coverMorphing, PROJECT_COVER_MORPH, useProjectCoverImage } from "./project-cover-cache"
import { ProjectCover } from "./project-home"

export function ProjectCoverCard(props: {
  project: ProjectRecord
  directory: string
  index: number
  onOpen: () => void
}) {
  const language = useLanguage()
  const cover = useProjectCoverImage(
    () => props.directory,
    () => props.project,
  )
  const percent = () => Math.max(0, Math.min(100, props.project.progressPercent))
  return (
    <button
      type="button"
      data-project-row={props.project.id}
      class="group -m-1.5 flex min-w-0 flex-col gap-2.5 rounded-[18px] p-1.5 text-left animate-enter transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
      style={{ "animation-delay": `${Math.min(props.index, 8) * 40}ms` }}
      onClick={() => props.onOpen()}
    >
      <ProjectCover
        class="w-full transition-transform duration-short ease-standard group-hover:scale-[1.015] motion-reduce:transition-none"
        image={cover.image()}
        morph={coverMorphing() === props.project.id ? PROJECT_COVER_MORPH : undefined}
      />
      <span class="flex min-w-0 flex-col gap-1.5 px-1 pb-1">
        <span class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">{props.project.name}</span>
          <Show when={props.project.status !== "active"}>
            <span class="shrink-0 type-meta text-v2-text-text-muted">
              {language.t(
                props.project.status === "paused"
                  ? "secondBrain.projects.filter.paused"
                  : "secondBrain.projects.filter.archived",
              )}
            </span>
          </Show>
        </span>
        <Show when={props.project.outcome.trim() && props.project.outcome.trim() !== props.project.name.trim()}>
          <span class="truncate type-meta text-v2-text-text-muted">{props.project.outcome}</span>
        </Show>
        <span class="flex items-center gap-2.5">
          <span
            class="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-v2-background-bg-layer-03"
            aria-hidden="true"
          >
            <span class="block h-full rounded-full bg-v2-background-bg-accent" style={{ width: `${percent()}%` }} />
          </span>
          <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">{percent()}%</span>
        </span>
        <Show when={props.project.nextMilestone?.trim()}>
          {(milestone) => (
            <span class="truncate type-meta text-v2-text-text-faint">
              {language.t("secondBrain.projects.card.next", { milestone: milestone() })}
            </span>
          )}
        </Show>
      </span>
    </button>
  )
}
