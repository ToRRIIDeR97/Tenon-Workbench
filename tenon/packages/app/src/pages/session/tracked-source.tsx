import { For, Match, Show, Switch, onMount } from "solid-js"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import { useLanguage } from "@/context/language"
import type { TrackedRow } from "@/pages/session/tracked-edits"

export type TrackedReview = { base: string; kept: ReadonlySet<string> }

const reviews = new Map<string, TrackedReview>()
export const trackedReview = {
  get: (key: string) => reviews.get(key),
  set: (key: string, review: TrackedReview | undefined) => (review ? reviews.set(key, review) : reviews.delete(key)),
}

const pill =
  "h-7 rounded-full px-3 type-control text-v2-text-text-base outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] disabled:opacity-50 motion-reduce:transition-none"
const outlined = `${pill} shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]`

export function TrackedSource(props: {
  rows: readonly TrackedRow[]
  count: number
  review: boolean
  busy: boolean
  conflict: boolean
  onKeep: (hunk: number) => void
  onUndo: (hunk: number) => void
  onKeepAll: () => void
  onUndoAll: () => void
  onReload: () => void
  onOverride: () => void
  onReady?: () => void
}) {
  const language = useLanguage()
  let root: HTMLDivElement | undefined
  onMount(() => props.onReady?.())
  const keep = (hunk: number) => {
    const rows = Array.from(root?.querySelectorAll<HTMLElement>(`[data-hunk="${hunk}"]`) ?? [])
    if (prefersReducedMotion() || rows.length === 0) return props.onKeep(hunk)
    const animations = rows.map((row) =>
      row.animate([{ opacity: 1 }, { opacity: row.dataset.row === "added" ? 1 : 0, backgroundColor: "transparent" }], {
        duration: motionDuration("medium"),
        easing: "ease-out",
        fill: "forwards",
      }),
    )
    void Promise.all(animations.map((animation) => animation.finished)).finally(() => props.onKeep(hunk))
  }
  return (
    <div
      ref={root}
      data-slot="tracked-source"
      class="flex flex-col pb-40"
      aria-label={language.t("secondBrain.trackedEdits.region")}
    >
      <Show when={props.review && props.count > 0}>
        <div
          data-slot="tracked-header"
          class="sticky top-0 z-10 flex items-center gap-1 bg-v2-background-bg-base px-4 py-1.5"
        >
          <span class="mr-auto type-control text-v2-text-text-base">
            {language.plural("secondBrain.trackedEdits.count", props.count, { count: props.count })}
          </span>
          <button
            type="button"
            data-action="tracked-undo-all"
            class={pill}
            disabled={props.busy}
            onClick={() => props.onUndoAll()}
          >
            {language.t("secondBrain.trackedEdits.undoAll")}
          </button>
          <button
            type="button"
            data-action="tracked-keep-all"
            class={outlined}
            disabled={props.busy}
            onClick={() => props.onKeepAll()}
          >
            {language.t("secondBrain.trackedEdits.keepAll")}
          </button>
        </div>
      </Show>
      <Show when={props.conflict}>
        <div
          role="alert"
          data-slot="tracked-conflict"
          class="mx-4 mb-2 flex items-center gap-2 rounded-[var(--v2-radius-md)] bg-v2-state-bg-warning px-3 py-2"
        >
          <span class="mr-auto type-control text-v2-state-fg-warning">
            {language.t("secondBrain.trackedEdits.conflict")}
          </span>
          <button
            type="button"
            data-action="tracked-reload"
            class={pill}
            disabled={props.busy}
            onClick={() => props.onReload()}
          >
            {language.t("secondBrain.trackedEdits.reload")}
          </button>
          <button
            type="button"
            data-action="tracked-override"
            class={outlined}
            disabled={props.busy}
            onClick={() => props.onOverride()}
          >
            {language.t("secondBrain.trackedEdits.override")}
          </button>
        </div>
      </Show>
      <div class="px-4 font-mono text-[12px] leading-5 text-v2-text-text-base">
        <For each={props.rows}>
          {(row) => (
            <Switch>
              <Match when={row.kind === "review" && row}>
                {(item) => (
                  <Show when={props.review}>
                    <div
                      role="group"
                      data-slot="tracked-review"
                      data-hunk-review={item().hunk}
                      aria-label={language.t("secondBrain.trackedEdits.change", { index: item().hunk + 1 })}
                      class="flex gap-1 py-1 pl-12 font-sans"
                    >
                      <button
                        type="button"
                        data-action="tracked-keep"
                        class={outlined}
                        disabled={props.busy}
                        onClick={() => keep(item().hunk)}
                      >
                        {language.t("secondBrain.trackedEdits.keep")}
                      </button>
                      <button
                        type="button"
                        data-action="tracked-undo"
                        class={pill}
                        disabled={props.busy}
                        onClick={() => props.onUndo(item().hunk)}
                      >
                        {language.t("secondBrain.trackedEdits.undo")}
                      </button>
                    </div>
                  </Show>
                )}
              </Match>
              <Match when={row.kind !== "review" && row}>
                {(item) => {
                  const line = item() as Exclude<TrackedRow, { kind: "review" }>
                  return (
                    <div
                      data-row={line.kind}
                      data-hunk={"hunk" in line ? line.hunk : undefined}
                      class="grid grid-cols-[2.5rem_1fr] gap-2"
                      classList={{
                        "bg-v2-state-bg-danger text-v2-text-text-muted": line.kind === "removed",
                        "bg-v2-state-bg-success shadow-[inset_2px_0_0_var(--v2-state-border-success)]":
                          line.kind === "added",
                      }}
                    >
                      <span class="select-none pr-1 text-right text-v2-text-text-muted" aria-hidden="true">
                        {"line" in line ? line.line : ""}
                      </span>
                      <span
                        class="whitespace-pre-wrap break-words"
                        classList={{ "line-through": line.kind === "removed" }}
                      >
                        <Show when={line.kind !== "same"}>
                          <span class="sr-only">
                            {line.kind === "removed"
                              ? language.t("secondBrain.trackedEdits.removed")
                              : language.t("secondBrain.trackedEdits.added")}
                            {": "}
                          </span>
                        </Show>
                        {line.text.replace(/\r$/, "") || " "}
                      </span>
                    </div>
                  )
                }}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </div>
  )
}
