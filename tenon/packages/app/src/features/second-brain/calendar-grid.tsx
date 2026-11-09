import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { TaskCheck } from "./calendar-peek"
import type { CalendarEvent, PlannerTask } from "./client"

export type CalendarGridDay = {
  date: string
  today: boolean
  day: number
  weekday: string
  /** Events with a start and end inside this day. */
  timed: CalendarEvent[]
  /** All-day and multi-day events shown in the strip above the hours. */
  allDay: CalendarEvent[]
  tasks: PlannerTask[]
}

const HOUR = 48

/** Day and Week views: an hour grid with all-day events and tasks in a strip above it. */
export function CalendarGrid(props: {
  days: CalendarGridDay[]
  selected: string
  onOpenEvent: (event: CalendarEvent) => void
  onOpenTask: (task: PlannerTask) => void
  onToggle: (task: PlannerTask) => Promise<void>
  onOpenDay: (date: string) => void
  onNewAt: (date: string, hour: number) => void
  dateLabel: (date: string) => string
}) {
  const language = useLanguage()
  // Office hours by default, widened to fit the earliest and latest event shown.
  const hours = createMemo(() => {
    const timed = props.days.flatMap((day) => day.timed)
    const first = Math.min(7, ...timed.map((event) => Math.floor(minutes(event.start!) / 60)))
    const last = Math.max(22, ...timed.map((event) => Math.ceil(minutes(event.end!) / 60)))
    return Array.from({ length: Math.min(last, 24) - first }, (_, index) => first + index)
  })
  const columns = () => `56px repeat(${props.days.length}, minmax(0, 1fr))`
  const blocks = (day: CalendarGridDay) => {
    const start = hours()[0] * 60
    const lanes: number[] = []
    const placed = [...day.timed]
      .sort((left, right) => minutes(left.start!) - minutes(right.start!))
      .map((event) => {
        const from = minutes(event.start!)
        const to = Math.max(minutes(event.end!), from + 15)
        const free = lanes.findIndex((end) => end <= from)
        const lane = free === -1 ? lanes.length : free
        lanes[lane] = to
        return { event, from, to, lane }
      })
    return placed.map((item) => ({
      ...item,
      style: {
        top: `${((item.from - start) / 60) * HOUR + 1}px`,
        height: `${Math.max(((item.to - item.from) / 60) * HOUR - 3, 22)}px`,
        left: `calc(${(item.lane / lanes.length) * 100}% + 2px)`,
        width: `calc(${100 / lanes.length}% - 6px)`,
      },
    }))
  }

  return (
    <div class="flex flex-col pb-4">
      <div
        class="sticky top-0 z-10 grid bg-v2-background-bg-base shadow-[inset_0_-1px_0_var(--v2-border-border-muted)]"
        style={{ "grid-template-columns": columns() }}
      >
        <span />
        <For each={props.days}>
          {(day) => (
            <button
              type="button"
              class="flex flex-col items-center gap-0.5 rounded-[12px] py-1.5 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
              aria-current={day.today ? "date" : undefined}
              onClick={() => props.onOpenDay(day.date)}
            >
              <span class="type-caption text-v2-text-text-muted">{day.weekday}</span>
              <span
                classList={{
                  "flex size-8 items-center justify-center rounded-full text-[15px]": true,
                  "bg-v2-background-bg-accent text-v2-text-text-contrast [font-weight:600]": day.today,
                  "text-v2-text-text-base [font-weight:500]": !day.today,
                }}
              >
                {day.day}
              </span>
            </button>
          )}
        </For>
        <Show when={props.days.some((day) => day.allDay.length > 0 || day.tasks.length > 0)}>
          <span class="pt-2 type-caption text-v2-text-text-muted">{language.t("secondBrain.calendar.allDay")}</span>
          <For each={props.days}>
            {(day) => (
              <div class="flex min-w-0 flex-col gap-1 px-0.5 pb-2 pt-1">
                <For each={day.allDay}>
                  {(event) => (
                    <TooltipV2 class="min-w-0 shrink-0" value={event.title}>
                      <button
                        type="button"
                        classList={{
                          "h-6 w-full min-w-0 truncate rounded-[8px] px-2 text-left text-[12px] [font-weight:500] focus-visible:outline-offset-[-2px]": true,
                          "bg-v2-background-bg-accent text-v2-text-text-contrast": props.selected === event.id,
                          "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container hover:brightness-95":
                            props.selected !== event.id,
                        }}
                        onClick={() => props.onOpenEvent(event)}
                      >
                        {event.title}
                      </button>
                    </TooltipV2>
                  )}
                </For>
                <For each={day.tasks}>
                  {(task) => (
                    <div
                      classList={{
                        "flex h-7 min-w-0 items-center gap-1.5 rounded-full pl-1.5 pr-2.5": true,
                        "bg-v2-background-bg-accent-container": props.selected === `task:${task.id}`,
                        "bg-v2-background-bg-layer-01": props.selected !== `task:${task.id}`,
                      }}
                    >
                      <TaskCheck task={task} onToggle={props.onToggle} small />
                      <TooltipV2 class="min-w-0 flex-1" value={task.title}>
                        <button
                          type="button"
                          class="w-full min-w-0 truncate rounded-[8px] text-left text-[12px] text-v2-text-text-base focus-visible:outline-offset-[-2px]"
                          onClick={() => props.onOpenTask(task)}
                        >
                          {task.title}
                        </button>
                      </TooltipV2>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="relative mt-2 grid" style={{ "grid-template-columns": columns() }}>
        <div class="relative" style={{ height: `${hours().length * HOUR}px` }}>
          <For each={hours()}>
            {(hour, index) => (
              <span
                class="absolute left-0 w-12 -translate-y-2 type-caption tabular-nums text-v2-text-text-muted"
                style={{ top: `${index() * HOUR}px` }}
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </span>
            )}
          </For>
        </div>
        <For each={props.days}>
          {(day) => (
            <div
              classList={{
                "relative shadow-[inset_1px_0_0_var(--v2-border-border-muted)]": true,
                // Today stands out among several days; alone (the Today view) a tint would just fill the grid.
                "bg-[color-mix(in_srgb,var(--v2-background-bg-accent-container)_35%,transparent)]":
                  day.today && props.days.length > 1,
              }}
              style={{
                height: `${hours().length * HOUR}px`,
                "background-image": `repeating-linear-gradient(to bottom, var(--v2-border-border-muted) 0 1px, transparent 1px ${HOUR}px)`,
              }}
            >
              {/* Out of the tab order: New stays the keyboard path, and a week would add over 100 stops. */}
              <For each={hours()}>
                {(hour, index) => (
                  <button
                    type="button"
                    tabindex={-1}
                    class="absolute inset-x-0 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
                    style={{ top: `${index() * HOUR}px`, height: `${HOUR}px` }}
                    aria-label={language.t("secondBrain.calendar.newAtTime", {
                      date: props.dateLabel(day.date),
                      time: `${String(hour).padStart(2, "0")}:00`,
                    })}
                    onClick={() => props.onNewAt(day.date, hour)}
                  />
                )}
              </For>
              <For each={blocks(day)}>
                {(block) => (
                  <div class="absolute" style={block.style}>
                    <TooltipV2 class="size-full" value={block.event.title}>
                      <button
                        type="button"
                        classList={{
                          "flex size-full flex-col gap-px overflow-hidden rounded-[8px] px-2 py-1 text-left text-[12px] leading-4 transition-[filter] duration-short ease-standard hover:brightness-110 focus-visible:outline-offset-[-2px] motion-reduce:transition-none": true,
                          "bg-v2-background-bg-accent text-v2-text-text-contrast": props.selected === block.event.id,
                          "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container":
                            props.selected !== block.event.id,
                        }}
                        onClick={() => props.onOpenEvent(block.event)}
                      >
                        <span class="truncate [font-weight:600]">{block.event.title}</span>
                        <span class="truncate opacity-85">{`${block.event.start} – ${block.event.end}`}</span>
                      </button>
                    </TooltipV2>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function minutes(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}
