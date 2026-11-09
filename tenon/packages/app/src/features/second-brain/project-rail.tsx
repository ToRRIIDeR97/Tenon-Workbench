import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { PageEmpty } from "@/components/page"
import { focusWhenConnected } from "@/utils/focus-when-connected"
import { getRelativeTime } from "@/utils/time"
import type { LogEntry, VaultPageInfo } from "./client"
import { labelClass, type ProjectCard } from "./project-details"

/**
 * The Project page's right rail: Progress (with next milestone and blocker), Pages, Threads and Log, each a card.
 * Every card is a labelled region, so links and older `?section=` jumps still find it by name or id.
 */

export type Loaded<T> = { value?: T; loading: boolean; failed: boolean; retry: () => void }
export type ProjectThread = { id: string; title: string; updated: number; running: boolean }

const cardClass =
  "flex scroll-mt-6 flex-col gap-3 rounded-[16px] bg-v2-background-bg-layer-01 p-3 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
// Filled like the page's other inputs; the textarea's own ring and focus ring stay.
const fieldClass = "!w-full !min-h-0 [background:var(--v2-background-bg-base)]"
// A 6px track filled to the value with a small round handle. The native range input keeps keyboard and screen
// reader support.
const sliderClass =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-v2-background-bg-accent [&::-webkit-slider-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01)] focus-visible:[&::-webkit-slider-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01),0_0_0_5px_var(--v2-border-border-focus)] [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-v2-background-bg-accent [&::-moz-range-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01)] focus-visible:[&::-moz-range-thumb]:[box-shadow:0_0_0_3px_var(--v2-background-bg-layer-01),0_0_0_5px_var(--v2-border-border-focus)]"

/** A loaded value's view, or its loading and error states. */
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

function CardHeading(props: { id: string; title: string; actions?: JSX.Element }) {
  return (
    <div class="flex min-h-7 items-center gap-2">
      <h2 id={props.id} class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
        {props.title}
      </h2>
      {props.actions}
    </div>
  )
}

/** The manual progress, next milestone and blocker; a set blocker reads as a warning chip until clicked. */
export function ProgressCard(props: { card: ProjectCard }) {
  const language = useLanguage()
  const state = props.card.state
  const setState = props.card.setState
  const [local, setLocal] = createStore({ editingBlocker: false })
  return (
    <section id="project-settings" aria-labelledby="project-progress-label" class={cardClass}>
      <div class="flex min-h-7 items-center gap-2">
        <label id="project-progress-label" for="project-progress" class="flex-1 type-section text-v2-text-text-base">
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
        class={sliderClass}
        style={{
          background: `linear-gradient(to right, var(--v2-background-bg-accent) ${state.progress}%, var(--v2-background-bg-layer-03) ${state.progress}%)`,
        }}
        onInput={(event) => setState("progress", Number(event.currentTarget.value))}
      />
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

export function PagesCard(props: {
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
    <section id="project-pages" aria-labelledby="project-pages-title" class={cardClass}>
      <CardHeading id="project-pages-title" title={language.t("secondBrain.project.pages")} />
      <ul class="grid grid-cols-2 gap-2">
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
                {/* A hand-edited `updated_at` may not parse; the server then sends "". */}
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
    </section>
  )
}

export function ThreadsCard(props: {
  threads: ReadonlyArray<ProjectThread>
  threadHref: (id: string) => string
  onNewThread?: () => void
}) {
  const language = useLanguage()
  return (
    <section id="project-threads" aria-labelledby="project-threads-title" class={cardClass}>
      <CardHeading
        id="project-threads-title"
        title={language.t("secondBrain.project.threads")}
        actions={
          <ButtonV2
            size="small"
            variant="ghost"
            icon="plus"
            disabled={!props.onNewThread}
            onClick={() => props.onNewThread?.()}
          >
            {language.t("secondBrain.project.newThread")}
          </ButtonV2>
        }
      />
      <Show
        when={props.threads.length > 0}
        fallback={<p class="type-caption text-v2-text-text-muted">{language.t("secondBrain.project.threadsEmpty")}</p>}
      >
        <ul class="-mx-1 flex flex-col">
          <For each={props.threads}>
            {(thread) => (
              <li>
                <a
                  href={props.threadHref(thread.id)}
                  class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-[8px] px-1.5 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                >
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
      </Show>
    </section>
  )
}

export function LogCard(props: { log: Loaded<ReadonlyArray<LogEntry>> }) {
  const language = useLanguage()
  return (
    <section id="project-log" aria-labelledby="project-log-title" class={cardClass}>
      <CardHeading id="project-log-title" title={language.t("secondBrain.project.log")} />
      {loadedView(props.log, (entries) => (
        <Show
          when={entries.length > 0}
          fallback={<p class="type-caption text-v2-text-text-muted">{language.t("secondBrain.vault.log.empty")}</p>}
        >
          <ol class="flex max-h-[360px] flex-col gap-2 overflow-y-auto">
            <For each={entries}>
              {(entry) => (
                <li class="flex min-w-0 flex-col gap-0.5">
                  <span class="flex min-w-0 items-baseline gap-2 type-caption text-v2-text-text-muted">
                    <time datetime={entry.at} class="shrink-0 font-mono tabular-nums">
                      {new Date(entry.at).toLocaleString(language.intl(), {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span class="min-w-0 truncate">{entry.author}</span>
                  </span>
                  <span class="break-words type-meta text-v2-text-text-base">{entry.text}</span>
                </li>
              )}
            </For>
          </ol>
        </Show>
      ))}
    </section>
  )
}
