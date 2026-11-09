import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { useLanguage } from "@/context/language"
import {
  prefersReducedMotion,
  type CalendarPreview,
  type EmailPreview,
  type Kind,
  type NotePreview,
  type TasksPreview,
  type TimelinePreview,
} from "./store"

/**
 * The shared preview of one agent write, used by the inline card, the pill and the step list. While
 * `typing` is set (a write in progress, motion allowed) note and email text appear as if typed; with
 * reduced motion the final content shows at once.
 */
export function AgentWritePreview(props: { kind: Kind; preview: unknown; typing?: boolean }) {
  const language = useLanguage()
  // Reduced motion never types: the final text is there from the first render.
  const reduced = prefersReducedMotion()
  const typing = () => Boolean(props.typing) && !reduced
  const value = () =>
    (props.preview && typeof props.preview === "object" ? props.preview : {}) as Record<string, unknown>
  return (
    <div data-slot="agent-write-preview" class="min-w-0 text-[13px] leading-5 text-v2-text-text-base">
      <Switch>
        <Match when={props.kind === "note"}>
          <NoteBody preview={value() as NotePreview} typing={typing()} />
        </Match>
        <Match when={props.kind === "tasks"}>
          {/* A group of rows, not a list: the Command Centre's step list owns the list items around it. */}
          <div role="group" class="flex flex-col gap-1" aria-label={language.t("secondBrain.agentWrites.kind.tasks")}>
            <For each={(value() as TasksPreview).tasks ?? []}>
              {(task) => (
                <div data-slot="agent-write-task" class="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" class="size-3 shrink-0 rounded-[4px] border border-v2-border-border-muted" />
                  <span class="truncate">{task.title}</span>
                  <Show when={task.dueDate}>
                    {(due) => <span class="ml-auto shrink-0 text-v2-text-text-muted">{due()}</span>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.kind === "calendar"}>
          <div class="flex flex-col gap-1.5">
            <For each={(value() as CalendarPreview).events ?? []}>
              {(event) => (
                <div
                  data-slot="agent-write-event"
                  class="flex flex-col rounded-[8px] border-l-2 border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2.5 py-1.5"
                >
                  <span class="truncate font-[500]">{event.title}</span>
                  <span class="text-v2-text-text-muted">
                    {[event.date, event.start && event.end ? `${event.start}–${event.end}` : undefined]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.kind === "timeline"}>
          <TimelineBars preview={value() as TimelinePreview} />
        </Match>
        <Match when={props.kind === "email"}>
          <EmailDraft preview={value() as EmailPreview} typing={typing()} />
        </Match>
      </Switch>
    </div>
  )
}

function NoteBody(props: { preview: NotePreview; typing?: boolean }) {
  const text = useTyped(
    () => props.preview.text ?? "",
    () => props.typing,
  )
  return (
    <div class="flex flex-col gap-1 min-w-0">
      <Show when={props.preview.title}>{(title) => <span class="font-[500] truncate">{title()}</span>}</Show>
      <p class="whitespace-pre-wrap break-words text-v2-text-text-muted line-clamp-6">{text()}</p>
    </div>
  )
}

function EmailDraft(props: { preview: EmailPreview; typing?: boolean }) {
  const language = useLanguage()
  const body = useTyped(
    () => props.preview.body ?? "",
    () => props.typing,
  )
  return (
    <div class="flex flex-col gap-1 min-w-0">
      <div class="flex gap-2 min-w-0">
        <span class="shrink-0 text-v2-text-text-muted">{language.t("secondBrain.agentWrites.email.to")}</span>
        <span class="truncate">{props.preview.to}</span>
      </div>
      <div class="flex gap-2 min-w-0">
        <span class="shrink-0 text-v2-text-text-muted">{language.t("secondBrain.agentWrites.email.subject")}</span>
        <span class="truncate font-[500]">{props.preview.subject}</span>
      </div>
      <p class="whitespace-pre-wrap break-words line-clamp-6">{body()}</p>
      <p class="text-[12px] leading-4 text-v2-text-text-muted">{language.t("secondBrain.agentWrites.email.draft")}</p>
    </div>
  )
}

/** One bar per item across the items' date range; items without dates span the whole row. */
function TimelineBars(props: { preview: TimelinePreview }) {
  const items = () => props.preview.items ?? []
  const range = () => {
    const times = items()
      .flatMap((item) => [item.start, item.end])
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter(Number.isFinite)
    if (times.length === 0) return undefined
    const from = Math.min(...times)
    return { from, span: Math.max(1, Math.max(...times) - from) }
  }
  const bar = (item: { start?: string; end?: string }) => {
    const span = range()
    const start = item.start ? Date.parse(item.start) : NaN
    const end = item.end ? Date.parse(item.end) : start
    if (!span || !Number.isFinite(start)) return { left: "0%", width: "100%" }
    const left = ((start - span.from) / span.span) * 100
    const width = Math.max(4, ((Math.max(end, start) - start) / span.span) * 100)
    return { left: `${Math.min(96, left)}%`, width: `${Math.min(100 - Math.min(96, left), width)}%` }
  }
  return (
    <div class="flex flex-col gap-1.5">
      <For each={items()}>
        {(item) => (
          <div
            data-slot="agent-write-bar"
            data-status={item.status}
            class="grid grid-cols-[minmax(0,40%)_1fr] gap-2 items-center"
          >
            <span class="truncate">{item.title}</span>
            <span class="relative h-2 rounded-full bg-v2-background-bg-layer-02">
              <span
                class="absolute inset-y-0 rounded-full"
                classList={{
                  "bg-v2-icon-icon-muted": item.status === "done",
                  "bg-v2-border-border-muted": item.status !== "done",
                }}
                style={bar(item)}
              />
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

/** `text` revealed a few characters per frame while `typing` holds, in at most about a second. */
function useTyped(text: () => string, typing: () => boolean | undefined) {
  const [shown, setShown] = createSignal(typing() ? "" : text())
  createEffect(
    on([text, typing], ([value, active]) => {
      if (!active) return setShown(value)
      const step = Math.max(2, Math.ceil(value.length / 60))
      let length = Math.min(shown().length, value.length)
      const timer = setInterval(() => {
        length = Math.min(value.length, length + step)
        setShown(value.slice(0, length))
        if (length >= value.length) clearInterval(timer)
      }, 16)
      onCleanup(() => clearInterval(timer))
    }),
  )
  return shown
}
