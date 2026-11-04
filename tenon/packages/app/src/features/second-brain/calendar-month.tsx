import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { monthCellRows, monthCellShown, type CalendarDay } from "./calendar-domain"
import type { CalendarEvent, PlannerTask } from "./client"

const WEEKS = 6

/** Month view: six weeks of days, each showing as many items as fit and a button for the rest. */
export function CalendarMonth(props: {
  days: CalendarDay[]
  eventsFor: (date: string) => CalendarEvent[]
  tasksFor: (date: string) => PlannerTask[]
  dateLabel: (date: string) => string
  onOpenEvent: (event: CalendarEvent) => void
  onOpenTask: (task: PlannerTask) => void
  onOpenDay: (date: string) => void
  onNew: (date: string) => void
}) {
  const language = useLanguage()
  const [rows, setRows] = createSignal(1)
  const weekdays = createMemo(() =>
    Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(language.locale(), { weekday: "short" }).format(new Date(2024, 0, 7 + index, 12)),
    ),
  )
  let grid!: HTMLDivElement
  onMount(() => {
    const observer = new ResizeObserver((entries) =>
      setRows(monthCellRows((entries[0]?.contentRect.height ?? 0) / WEEKS)),
    )
    observer.observe(grid)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]">
      <div class="grid h-8 shrink-0 grid-cols-7 bg-v2-background-bg-layer-01">
        <For each={weekdays()}>
          {(weekday) => (
            <div class="flex items-center justify-center text-[12px] text-v2-text-text-muted [font-weight:500]">
              {weekday}
            </div>
          )}
        </For>
      </div>
      <div ref={grid} class="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        <For each={props.days}>
          {(day) => {
            const events = () => props.eventsFor(day.date)
            const tasks = () => props.tasksFor(day.date)
            const total = () => events().length + tasks().length
            const shown = () => monthCellShown(total(), rows())
            return (
              <div
                classList={{
                  "group/day flex min-h-0 flex-col items-stretch overflow-hidden border-b border-r border-v2-border-border-muted p-1 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0": true,
                  "bg-v2-background-bg-layer-01": !day.inMonth,
                }}
              >
                <div class="relative mb-1 flex shrink-0 justify-center">
                  <button
                    type="button"
                    classList={{
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] transition-colors duration-short ease-standard motion-reduce:transition-none": true,
                      "bg-v2-icon-icon-accent text-v2-icon-icon-contrast [font-weight:600]": day.today,
                      "hover:bg-v2-overlay-simple-overlay-hover": !day.today,
                      "text-v2-text-text-faint": !day.inMonth && !day.today,
                      "text-v2-text-text-muted": day.inMonth && !day.today,
                    }}
                    aria-label={language.t("secondBrain.calendar.openDate", { date: props.dateLabel(day.date) })}
                    aria-current={day.today ? "date" : undefined}
                    onClick={() => props.onOpenDay(day.date)}
                  >
                    {day.day}
                  </button>
                  <TooltipV2
                    class="absolute right-0 top-0"
                    value={language.t("secondBrain.calendar.newOnDate", { date: props.dateLabel(day.date) })}
                  >
                    <IconButtonV2
                      type="button"
                      size="small"
                      variant="ghost"
                      class="opacity-0 transition-opacity duration-short ease-standard focus-visible:opacity-100 group-hover/day:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                      icon={<Icon name="plus" />}
                      aria-label={language.t("secondBrain.calendar.newOnDate", { date: props.dateLabel(day.date) })}
                      onClick={() => props.onNew(day.date)}
                    />
                  </TooltipV2>
                </div>
                <div class="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                  <For each={events().slice(0, shown())}>
                    {(event) => (
                      <TooltipV2 class="min-w-0 shrink-0" value={event.title}>
                        <button
                          type="button"
                          class="min-h-6 w-full truncate rounded-[8px] bg-v2-background-bg-accent-container px-2 text-left text-[11px] text-v2-text-text-on-accent-container transition-[filter,border-radius] duration-short ease-standard hover:brightness-95 active:rounded-[4px] focus-visible:outline-offset-[-2px] motion-reduce:transition-none"
                          onClick={() => props.onOpenEvent(event)}
                        >
                          <Show when={event.start && event.date === day.date}>
                            <span class="mr-1 opacity-70">{event.start}</span>
                          </Show>
                          {event.title}
                        </button>
                      </TooltipV2>
                    )}
                  </For>
                  <For each={tasks().slice(0, Math.max(shown() - events().length, 0))}>
                    {(task) => (
                      <TooltipV2 class="min-w-0 shrink-0" value={task.title}>
                        <button
                          type="button"
                          class="min-h-6 w-full truncate rounded-[8px] px-2 text-left text-[11px] text-v2-text-text-muted shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] transition-[background-color,border-radius] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:rounded-[4px] focus-visible:outline-offset-[-2px] motion-reduce:transition-none"
                          onClick={() => props.onOpenTask(task)}
                        >
                          <Show when={task.start}>
                            <span class="mr-1 text-v2-text-text-faint">{task.start}</span>
                          </Show>
                          {task.title}
                        </button>
                      </TooltipV2>
                    )}
                  </For>
                  <Show when={total() > shown()}>
                    <button
                      type="button"
                      class="min-h-6 w-full shrink-0 truncate rounded-[8px] px-2 text-left text-[11px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-offset-[-2px] motion-reduce:transition-none"
                      aria-label={language.plural("secondBrain.calendar.moreOnDate", total() - shown(), {
                        date: props.dateLabel(day.date),
                      })}
                      onClick={() => props.onOpenDay(day.date)}
                    >
                      {language.t("secondBrain.calendar.more", { count: total() - shown() })}
                    </button>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
