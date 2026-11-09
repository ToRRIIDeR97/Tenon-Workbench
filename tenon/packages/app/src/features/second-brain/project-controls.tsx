import { Popover } from "@tenon/ui/popover"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { TimelineItem } from "./client"

/**
 * The Projects page's own controls, in place of native `<select>` and `<input type="date">`: a date chip with a
 * picker, a status pill with a menu, and the Task/Milestone switch. Dates are local `YYYY-MM-DD` days.
 */

export const statuses = ["todo", "doing", "done"] as const
export const kinds = ["task", "milestone"] as const

const statusDot: Record<TimelineItem["status"], string> = {
  todo: "bg-v2-icon-icon-muted",
  doing: "bg-v2-icon-icon-accent",
  done: "bg-v2-state-fg-success",
}

const chipClass =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-02 px-2.5 text-[12px] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-03 data-[expanded]:bg-v2-background-bg-layer-03 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"

/** A local calendar day as `YYYY-MM-DD`, `offset` days from `from`. */
export function localDay(from = new Date(), offset = 0) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** "Fri 13 Nov" in the app's locale, or "" for a value that isn't a day. */
export function dayLabel(value: string | undefined, locale: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })
}

/** The days of `month` (`YYYY-MM`) in weeks from Monday; days outside the month are undefined. */
export function monthDays(month: string) {
  const [year, index] = month.split("-").map(Number)
  const count = new Date(year, index, 0).getDate()
  const lead = new Date(year, index - 1, 1).getDay()
  return [
    ...Array.from({ length: lead }, () => undefined),
    ...Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, "0")}`),
  ]
}

/** A date chip that opens a picker: quick picks, then a month grid. */
export function DateChip(props: {
  value?: string
  label: string
  onChange: (value: string | undefined) => void
  disabled?: boolean
}) {
  const language = useLanguage()
  const today = () => localDay()
  const [state, setState] = createStore({ open: false, month: (props.value ?? today()).slice(0, 7) })
  const pick = (value: string | undefined) => {
    props.onChange(value)
    setState("open", false)
  }
  const monthLabel = () => {
    const [year, month] = state.month.split("-").map(Number)
    return new Date(year, month - 1, 1).toLocaleDateString(language.intl(), { month: "long", year: "numeric" })
  }
  const shift = (offset: number) => {
    const [year, month] = state.month.split("-").map(Number)
    const next = new Date(year, month - 1 + offset, 1)
    setState("month", `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`)
  }
  const weekdays = createMemo(() =>
    // 2026-11-01 is a Sunday, the Calendar's first day of the week.
    Array.from({ length: 7 }, (_, index) =>
      new Date(2026, 10, 1 + index).toLocaleDateString(language.intl(), { weekday: "narrow" }),
    ),
  )
  const quick = () => [
    { label: language.t("secondBrain.project.today"), value: today() },
    { label: language.t("secondBrain.project.tomorrow"), value: localDay(new Date(), 1) },
    { label: language.t("secondBrain.project.nextWeek"), value: localDay(new Date(), 7) },
  ]
  return (
    <Popover
      open={state.open}
      onOpenChange={(open) => setState({ open, month: (props.value ?? today()).slice(0, 7) })}
      placement="bottom-start"
      gutter={6}
      class="w-[272px] [&_[data-slot=popover-body]]:p-3"
      triggerAs="button"
      triggerProps={{ type: "button", class: chipClass, "aria-label": props.label, disabled: props.disabled }}
      trigger={
        <>
          <Icon name="calendar" size="small" class="text-v2-icon-icon-muted" />
          <span class="tabular-nums">
            {dayLabel(props.value, language.intl()) || language.t("secondBrain.project.noDate")}
          </span>
        </>
      }
    >
      <div class="flex flex-col gap-2" data-component="date-picker">
        <div class="flex flex-wrap gap-1.5">
          <For each={quick()}>
            {(item) => (
              <button type="button" class={chipClass} onClick={() => pick(item.value)}>
                {item.label}
              </button>
            )}
          </For>
          <Show when={props.value}>
            <button type="button" class={chipClass} onClick={() => pick(undefined)}>
              {language.t("secondBrain.project.noDate")}
            </button>
          </Show>
        </div>
        <div class="flex items-center gap-1 pt-1">
          <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:500]">
            {monthLabel()}
          </span>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            class="!size-7"
            aria-label={language.t("secondBrain.vault.calendar.previous")}
            icon={<Icon name="chevron-left" size="small" />}
            onClick={() => shift(-1)}
          />
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            class="!size-7"
            aria-label={language.t("secondBrain.vault.calendar.next")}
            icon={<Icon name="chevron-right" size="small" />}
            onClick={() => shift(1)}
          />
        </div>
        <div class="grid grid-cols-7 text-center text-[11px] text-v2-text-text-muted">
          <For each={weekdays()}>{(name) => <span>{name}</span>}</For>
        </div>
        <div class="grid grid-cols-7 gap-0.5">
          <For each={monthDays(state.month)}>
            {(day) => (
              <Show when={day} fallback={<span />}>
                {(value) => (
                  <button
                    type="button"
                    aria-label={dayLabel(value(), language.intl())}
                    aria-pressed={value() === props.value}
                    classList={{
                      "h-8 rounded-full text-[12px] tabular-nums transition-colors duration-short ease-standard motion-reduce:transition-none": true,
                      "bg-v2-background-bg-accent text-v2-icon-icon-contrast [font-weight:600]":
                        value() === props.value,
                      "text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover": value() !== props.value,
                      "shadow-[inset_0_0_0_1px_var(--v2-border-border-focus)]":
                        value() === today() && value() !== props.value,
                    }}
                    onClick={() => pick(value())}
                  >
                    {Number(value().slice(8))}
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
      </div>
    </Popover>
  )
}

/** A status pill with a coloured dot; it opens a menu of To do, Doing and Done. */
export function StatusMenu(props: {
  value: TimelineItem["status"]
  label: string
  onChange: (status: TimelineItem["status"]) => void
  disabled?: boolean
}) {
  const language = useLanguage()
  return (
    <MenuV2 gutter={4} modal={false} placement="bottom-end">
      <MenuV2.Trigger as="button" type="button" class={chipClass} aria-label={props.label} disabled={props.disabled}>
        <span class={`size-2 rounded-full ${statusDot[props.value]}`} aria-hidden="true" />
        {language.t(`secondBrain.vault.status.${props.value}`)}
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.RadioGroup
            value={props.value}
            onChange={(value) => {
              const status = statuses.find((item) => item === value)
              if (status) props.onChange(status)
            }}
          >
            <For each={statuses}>
              {(status) => (
                <MenuV2.RadioItem value={status}>
                  <span class="flex items-center gap-2">
                    <span class={`size-2 rounded-full ${statusDot[status]}`} aria-hidden="true" />
                    {language.t(`secondBrain.vault.status.${status}`)}
                  </span>
                </MenuV2.RadioItem>
              )}
            </For>
          </MenuV2.RadioGroup>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

/** Task or milestone: two choices, so a switch rather than a dropdown. */
export function KindSwitch(props: { value: TimelineItem["kind"]; onChange: (kind: TimelineItem["kind"]) => void }) {
  const language = useLanguage()
  return (
    <SegmentedControlV2
      class="!w-auto shrink-0"
      aria-label={language.t("secondBrain.vault.item.kind")}
      value={props.value}
      onChange={(value) => {
        const kind = kinds.find((item) => item === value)
        if (kind) props.onChange(kind)
      }}
    >
      <SegmentedControlItemV2 value="task">{language.t("secondBrain.vault.item.task")}</SegmentedControlItemV2>
      <SegmentedControlItemV2 value="milestone">{language.t("secondBrain.vault.milestone")}</SegmentedControlItemV2>
    </SegmentedControlV2>
  )
}
