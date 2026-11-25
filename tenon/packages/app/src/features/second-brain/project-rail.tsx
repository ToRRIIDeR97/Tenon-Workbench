import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { PageEmpty } from "@/components/page"
import { focusWhenConnected } from "@/utils/focus-when-connected"
import type { VaultPageInfo } from "./client"
import { labelClass, type ProjectCard } from "./project-details"

export type Loaded<T> = { value?: T; loading: boolean; failed: boolean; retry: () => void }
export type ProjectThread = { id: string; title: string; updated: number; running: boolean }

const cardClass =
  "flex scroll-mt-6 flex-col gap-3 rounded-[16px] bg-v2-background-bg-layer-01 p-3 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
const fieldClass = "!w-full !min-h-0 [background:var(--v2-background-bg-base)]"
const sliderClass =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-v2-background-bg-accent [&::-webkit-slider-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01)] focus-visible:[&::-webkit-slider-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01),0_0_0_5px_var(--v2-border-border-focus)] [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-v2-background-bg-accent [&::-moz-range-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01)] focus-visible:[&::-moz-range-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01),0_0_0_5px_var(--v2-border-border-focus)]"

export function loadedView<T>(source: Loaded<T>, view: (value: T) => JSX.Element) {
  const language = useLanguage()
  return (
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
}

export function ProgressCard(props: { card: ProjectCard; tasks?: { percent?: number; done: number; total: number } }) {
  const language = useLanguage()
  const state = props.card.state
  const setState = props.card.setState
  const [local, setLocal] = createStore({ editingBlocker: false })
  return (
    <section id="project-status" aria-labelledby="project-progress-label" class={cardClass}>
      <Show
        when={props.tasks}
        fallback={
          <>
            <div class="flex min-h-7 items-center gap-2">
              <label
                id="project-progress-label"
                for="project-progress"
                class="flex-1 type-section text-v2-text-text-base"
              >
                {language.t("secondBrain.projects.progress")}
              </label>
              <output for="project-progress" class="type-meta tabular-nums text-v2-text-text-muted">
                {state.progress}%
              </output>
            </div>
            <input
              id="project-progress"
              type="range"
              min="0"
              max="100"
              value={state.progress}
              aria-describedby="project-progress-source"
              class={sliderClass}
              style={{
                background: `linear-gradient(to right, var(--v2-background-bg-accent) ${state.progress}%, var(--v2-background-bg-layer-03) ${state.progress}%)`,
              }}
              onInput={(event) => setState("progress", Number(event.currentTarget.value))}
            />
            <p id="project-progress-source" class="type-caption text-v2-text-text-muted">
              {language.t("secondBrain.projects.progress.manual")}
            </p>
          </>
        }
      >
        {(tasks) => (
          <>
            <div class="flex min-h-7 items-center gap-2">
              <h2 id="project-progress-label" class="flex-1 type-section text-v2-text-text-base">
                {language.t("secondBrain.projects.progress")}
              </h2>
              <span class="type-meta tabular-nums text-v2-text-text-muted">{tasks().percent ?? 0}%</span>
            </div>
            <div
              role="progressbar"
              aria-labelledby="project-progress-label"
              aria-describedby="project-progress-source"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={tasks().percent ?? 0}
              class="h-1.5 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-03"
            >
              <div
                class="h-full rounded-full bg-v2-background-bg-accent"
                style={{ width: `${tasks().percent ?? 0}%` }}
              />
            </div>
            <p id="project-progress-source" class="type-caption text-v2-text-text-muted">
              {language.t("secondBrain.projects.progress.fromTasks", { done: tasks().done, total: tasks().total })}
            </p>
          </>
        )}
      </Show>
      <label class={labelClass} for="project-next-milestone">
        {language.t("secondBrain.projects.nextMilestone")}
        <TextareaV2
          id="project-next-milestone"
          class={fieldClass}
          rows={2}
          value={state.nextMilestone}
          onInput={(event) => setState("nextMilestone", event.currentTarget.value)}
        />
      </label>
      <Show
        when={state.blocker.trim() && !local.editingBlocker}
        fallback={
          <label class={labelClass} for="project-blocker">
            {language.t("secondBrain.projects.blocker")}
            <TextareaV2
              id="project-blocker"
              ref={(element) => {
                if (local.editingBlocker) focusWhenConnected(element)
              }}
              class={fieldClass}
              rows={2}
              value={state.blocker}
              onInput={(event) => setState("blocker", event.currentTarget.value)}
              onBlur={() => setLocal("editingBlocker", false)}
            />
          </label>
        }
      >
        <div class={labelClass}>
          <span id="project-blocker-label">{language.t("secondBrain.projects.blocker")}</span>
          <button
            type="button"
            data-project-blocker
            aria-describedby="project-blocker-label"
            class="flex w-full items-start gap-2 rounded-[12px] bg-v2-state-bg-warning px-2.5 py-2 text-left type-meta text-v2-state-fg-warning transition-opacity duration-short ease-standard hover:opacity-90 motion-reduce:transition-none"
            onClick={() => setLocal("editingBlocker", true)}
          >
            <Icon name="warning" size="small" class="mt-px shrink-0" />
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{state.blocker}</span>
          </button>
        </div>
      </Show>
      <RevealShow when={state.error}>
        {(error) => (
          <p role="alert" class="type-caption text-v2-text-text-critical">
            {error()}
          </p>
        )}
      </RevealShow>
      <Show when={props.card.dirty()}>
        <div class="flex flex-wrap items-center gap-2">
          <ButtonV2 size="small" variant="contrast" disabled={state.saving} onClick={() => void props.card.save()}>
            {state.saving ? language.t("secondBrain.saving") : language.t("secondBrain.projects.saveState")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" disabled={state.saving} onClick={props.card.discard}>
            {language.t("secondBrain.projects.discard")}
          </ButtonV2>
          <span class="flex items-center gap-1.5 type-caption text-v2-text-text-muted" role="status">
            <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" aria-hidden="true" />
            {language.t("secondBrain.projects.unsaved")}
          </span>
        </div>
      </Show>
    </section>
  )
}

export function PagesGrid(props: {
  pages: ReadonlyArray<VaultPageInfo>
  pageHref: (path: string) => string
  onPage: (path: string) => void
  onNewPage: () => void
  creatingPage: boolean
  pageError: string
  dateLabel: (value: string) => string
}) {
  const language = useLanguage()
  const tile =
    "flex h-[72px] w-full flex-col gap-1 rounded-[12px] p-2.5 text-left transition-colors duration-short ease-standard motion-reduce:transition-none"
  return (
    <div class="flex flex-col gap-2">
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        <For each={props.pages}>
          {(page) => (
            <li class="min-w-0">
              <a
                href={props.pageHref(page.path)}
                class={`${tile} bg-v2-background-bg-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] hover:bg-v2-background-bg-layer-02`}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
                  event.preventDefault()
                  props.onPage(page.path)
                }}
              >
                <span class="line-clamp-2 break-words type-row-title text-v2-text-text-base" title={page.title}>
                  {page.title}
                </span>
                <Show when={Number.isFinite(Date.parse(page.updatedAt))}>
                  <span class="mt-auto type-caption tabular-nums text-v2-text-text-muted">
                    {props.dateLabel(new Date(page.updatedAt).toISOString())}
                  </span>
                </Show>
              </a>
            </li>
          )}
        </For>
        <li class="min-w-0">
          <button
            type="button"
            data-action="project-new-page"
            disabled={props.creatingPage}
            class={`${tile} items-center justify-center type-control text-v2-text-text-muted shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50`}
            onClick={props.onNewPage}
          >
            <Icon name="plus" size="small" />
            {language.t("secondBrain.vault.newPage")}
          </button>
        </li>
      </ul>
      <RevealShow when={props.pageError}>
        {(error) => (
          <p role="alert" class="type-caption text-v2-text-text-critical">
            {error()}
          </p>
        )}
      </RevealShow>
    </div>
  )
}
