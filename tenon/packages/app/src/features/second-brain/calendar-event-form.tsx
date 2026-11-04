import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { SelectV2 } from "@tenon/ui/v2/select-v2"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { GoogleAccount, GoogleCalendarProviderEvent } from "@/context/platform"
import { focusWhenConnected } from "@/utils/focus-when-connected"
import { localDateKey } from "./calendar-domain"
import type { CalendarEvent, ProjectRecord } from "./client"
import { DateChip } from "./project-controls"

export type CalendarDraft = {
  id: string
  title: string
  date: string
  endDate: string
  start: string
  end: string
  details: string
  projectId: string
  source: CalendarEvent["source"]
  syncState: CalendarEvent["syncState"]
  accountId: string
  providerId: string
  calendarId: string
  etag: string
  timezone: string
  allDay: boolean
  recurringSeriesId: string
  participantCount: number
  outboxKind: "" | "create" | "update" | "delete"
  outboxKey: string
}

export type CalendarDraftField = "" | "title" | "date" | "endDate" | "time"

export const emptyDraft = (date = localDateKey(new Date()), projectId = ""): CalendarDraft => ({
  id: "",
  title: "",
  date,
  endDate: "",
  start: "",
  end: "",
  details: "",
  projectId,
  source: "local" as CalendarEvent["source"],
  syncState: "local" as CalendarEvent["syncState"],
  accountId: "",
  providerId: "",
  calendarId: "primary",
  etag: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  allDay: true,
  recurringSeriesId: "",
  participantCount: 0,
  outboxKind: "",
  outboxKey: "",
})

/** A draft of an existing event; `accountId` is the event's account, resolved by the page for older items. */
export const eventDraft = (event: CalendarEvent, accountId: string | undefined): CalendarDraft => ({
  id: event.id,
  title: event.title,
  date: event.date,
  endDate: event.endDate ?? "",
  start: event.start ?? "",
  end: event.end ?? "",
  details: event.details ?? "",
  projectId: event.projectId ?? "",
  source: event.source,
  syncState: event.syncState,
  accountId: accountId ?? "",
  providerId: event.providerId ?? "",
  calendarId: event.calendarId ?? "primary",
  etag: event.etag ?? "",
  timezone: event.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  allDay: event.allDay ?? !event.start,
  recurringSeriesId: event.recurringSeriesId ?? "",
  participantCount: event.participantCount ?? 0,
  outboxKind: event.outboxKind ?? "",
  outboxKey: event.outboxKey ?? "",
})

export const draftProviderEvent = (draft: CalendarDraft): GoogleCalendarProviderEvent => ({
  accountId: draft.accountId,
  providerId: draft.providerId || "pending",
  calendarId: "primary",
  title: draft.title.trim(),
  date: draft.date,
  ...(draft.endDate ? { endDate: draft.endDate } : {}),
  ...(draft.start ? { start: draft.start } : {}),
  ...(draft.end ? { end: draft.end } : {}),
  ...(draft.details.trim() ? { details: draft.details.trim() } : {}),
  timezone: draft.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  allDay: !draft.start && !draft.end,
  ...(draft.recurringSeriesId ? { recurringSeriesId: draft.recurringSeriesId } : {}),
  participantCount: draft.participantCount,
  ...(draft.etag ? { etag: draft.etag } : {}),
})

export const fieldClass = "flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted"

export const noteClass =
  "rounded-[12px] bg-v2-background-bg-base px-3 py-2 text-[12px] leading-5 text-v2-text-text-muted"

const dateInputClass =
  "h-9 w-full min-w-0 rounded-[12px] border-0 bg-v2-background-bg-base px-3 text-[12px] text-v2-text-text-base outline-none transition-shadow duration-short ease-standard focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"

/** The event editor. The page owns the draft and the store; `state` is read here so the form stays reactive. */
export function CalendarEventForm(props: {
  state: {
    draft: CalendarDraft
    saving: boolean
    error: string
    errorField: CalendarDraftField
    confirmingDelete: boolean
    googleConfirm: "" | "save" | "delete"
  }
  projects: ReadonlyArray<ProjectRecord>
  googleAccounts: ReadonlyArray<GoogleAccount>
  accountLabel: (accountId: string) => string
  sourceLabel: (source: CalendarEvent["source"]) => string
  syncLabel: (syncState: CalendarEvent["syncState"]) => string
  formatDay: (date: string) => string
  onDraft: (patch: Partial<CalendarDraft>) => void
  onSave: () => void
  onKeepGoogle: () => void
  onRemove: () => void
  onClose: () => void
  onEscape: () => void
  onCancelConfirm: () => void
  onConfirm: () => void
}) {
  const language = useLanguage()
  return (
    <form
      class="flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSave()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        event.preventDefault()
        props.onEscape()
      }}
    >
      <div class="flex items-center gap-2">
        <h2 class="min-w-0 flex-1 text-[14px] text-v2-text-text-base [font-weight:500]">
          {props.state.draft.id ? language.t("secondBrain.calendar.edit") : language.t("secondBrain.calendar.new")}
        </h2>
        <Show when={props.state.draft.id}>
          <span class="rounded-full bg-v2-background-bg-base px-2 py-1 text-[10px] capitalize text-v2-text-text-faint">
            {props.sourceLabel(props.state.draft.source)} · {props.syncLabel(props.state.draft.syncState)}
          </span>
        </Show>
        <TooltipV2 value={language.t("common.cancel")}>
          <IconButtonV2
            type="button"
            size="small"
            variant="ghost"
            icon={<Icon name="close" />}
            aria-label={language.t("common.cancel")}
            onClick={props.onClose}
          />
        </TooltipV2>
      </div>
      <label class={fieldClass} for="calendar-event-title">
        {language.t("secondBrain.calendar.eventTitle")}
        <TextInputV2
          id="calendar-event-title"
          appearance="large"
          ref={focusWhenConnected}
          invalid={props.state.errorField === "title"}
          aria-describedby={props.state.errorField === "title" ? "calendar-event-error" : undefined}
          value={props.state.draft.title}
          onInput={(event) => props.onDraft({ title: event.currentTarget.value })}
        />
      </label>
      <Show when={!props.state.draft.id && props.googleAccounts.length > 0}>
        <label class={fieldClass} for="calendar-event-source">
          {language.t("secondBrain.calendar.google.destination")}
          <SelectV2
            id="calendar-event-source"
            aria-label={language.t("secondBrain.calendar.google.destination")}
            class="!h-8 !w-full"
            options={["local", ...props.googleAccounts.map((account) => account.id)]}
            current={props.state.draft.source === "google" ? props.state.draft.accountId : "local"}
            label={(source) =>
              source === "local"
                ? language.t("secondBrain.calendar.sync.local")
                : language.t("secondBrain.calendar.google.destinationAccount", {
                    account: props.accountLabel(source),
                  })
            }
            onSelect={(source) =>
              source &&
              props.onDraft({
                source: source === "local" ? "local" : "google",
                accountId: source === "local" ? "" : source,
                syncState: source === "local" ? "local" : "pending",
              })
            }
          />
        </label>
      </Show>
      <label class={fieldClass} for="calendar-event-project">
        {language.t("secondBrain.calendar.project")}
        <SelectV2
          id="calendar-event-project"
          aria-label={language.t("secondBrain.calendar.project")}
          class="!h-8 !w-full"
          options={["__none__", ...props.projects.map((project) => project.id)]}
          current={props.state.draft.projectId || "__none__"}
          label={(projectID) =>
            projectID === "__none__"
              ? language.t("secondBrain.calendar.noProject")
              : (props.projects.find((project) => project.id === projectID)?.name ?? projectID)
          }
          onSelect={(projectID) => props.onDraft({ projectId: projectID === "__none__" ? "" : (projectID ?? "") })}
        />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <div class={fieldClass}>
          {language.t("secondBrain.calendar.date")}
          <DateChip
            label={language.t("secondBrain.calendar.date")}
            value={props.state.draft.date || undefined}
            onChange={(value) => props.onDraft({ date: value ?? "" })}
          />
        </div>
        <div class={fieldClass}>
          {language.t("secondBrain.calendar.endDate")}
          <DateChip
            label={language.t("secondBrain.calendar.endDate")}
            value={props.state.draft.endDate || undefined}
            onChange={(value) => props.onDraft({ endDate: value ?? "" })}
          />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class={fieldClass} for="calendar-event-start">
          {language.t("secondBrain.calendar.start")}
          <input
            id="calendar-event-start"
            type="time"
            class={dateInputClass}
            aria-invalid={props.state.errorField === "time" ? true : undefined}
            aria-describedby={props.state.errorField === "time" ? "calendar-event-error" : undefined}
            value={props.state.draft.start}
            onInput={(event) => props.onDraft({ start: event.currentTarget.value })}
          />
        </label>
        <label class={fieldClass} for="calendar-event-end">
          {language.t("secondBrain.calendar.end")}
          <input
            id="calendar-event-end"
            type="time"
            class={dateInputClass}
            aria-invalid={props.state.errorField === "time" ? true : undefined}
            aria-describedby={props.state.errorField === "time" ? "calendar-event-error" : undefined}
            value={props.state.draft.end}
            onInput={(event) => props.onDraft({ end: event.currentTarget.value })}
          />
        </label>
      </div>
      <Show when={props.state.draft.source === "google" && (props.state.draft.start || props.state.draft.end)}>
        <p class="-mt-1 text-[11px] leading-4 text-v2-text-text-faint">
          {language.t("secondBrain.calendar.google.timezone", { timezone: props.state.draft.timezone })}
        </p>
      </Show>
      <label class={fieldClass} for="calendar-event-details">
        {language.t("secondBrain.calendar.details")}
        <TextareaV2
          id="calendar-event-details"
          rows={5}
          value={props.state.draft.details}
          onInput={(event) => props.onDraft({ details: event.currentTarget.value })}
        />
      </label>
      <Show
        when={
          props.state.draft.source === "google" &&
          (props.state.draft.recurringSeriesId || props.state.draft.participantCount > 0)
        }
      >
        <p role="status" class={noteClass}>
          {language.t("secondBrain.calendar.google.restricted")}
        </p>
      </Show>
      <Show when={props.state.draft.syncState === "conflict" && props.state.draft.outboxKey}>
        <div class="flex flex-col items-start gap-2 rounded-[16px] bg-v2-background-bg-base p-3 shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]">
          <p class="text-[12px] leading-5 text-v2-text-text-muted">
            {language.t("secondBrain.calendar.google.conflictNote")}
          </p>
          <ButtonV2
            type="button"
            size="small"
            variant="ghost"
            disabled={props.state.saving}
            onClick={props.onKeepGoogle}
          >
            {language.t("secondBrain.calendar.google.keepGoogle")}
          </ButtonV2>
        </div>
      </Show>
      <Show when={props.state.googleConfirm}>
        <div
          role="group"
          aria-label={language.t("secondBrain.calendar.google.confirm.title")}
          class="rounded-[16px] bg-v2-background-bg-base p-3 shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]"
        >
          <p class="text-[12px] leading-5 text-v2-text-text-base [font-weight:500]">
            {props.state.googleConfirm === "delete"
              ? language.t("secondBrain.calendar.google.confirm.delete")
              : language.t("secondBrain.calendar.google.confirm.save")}
          </p>
          <p class="mt-1 text-[11px] leading-4 text-v2-text-text-faint">
            {props.formatDay(props.state.draft.date)}
            <Show when={props.state.draft.start && props.state.draft.end}>
              {` · ${props.state.draft.start}–${props.state.draft.end} · ${props.state.draft.timezone}`}
            </Show>
          </p>
          <div class="mt-3 flex justify-end gap-2">
            <ButtonV2
              type="button"
              size="small"
              variant="ghost"
              disabled={props.state.saving}
              onClick={props.onCancelConfirm}
            >
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2
              type="button"
              size="small"
              variant={props.state.googleConfirm === "delete" ? "danger" : "contrast"}
              disabled={props.state.saving}
              onClick={props.onConfirm}
            >
              {props.state.saving
                ? language.t("secondBrain.saving")
                : language.t("secondBrain.calendar.google.confirm.action")}
            </ButtonV2>
          </div>
        </div>
      </Show>
      <Show when={props.state.error}>
        <p id="calendar-event-error" role="alert" class="text-[12px] text-v2-text-text-critical">
          {props.state.error}
        </p>
      </Show>
      <div class="flex items-center justify-between gap-2">
        <Show when={props.state.draft.id} fallback={<span />}>
          <ButtonV2
            type="button"
            size="small"
            variant="danger"
            disabled={props.state.saving || Boolean(props.state.googleConfirm)}
            onClick={props.onRemove}
          >
            {props.state.confirmingDelete
              ? language.t("secondBrain.calendar.confirmDelete")
              : language.t("common.delete")}
          </ButtonV2>
        </Show>
        <ButtonV2
          type="submit"
          size="small"
          variant="contrast"
          disabled={props.state.saving || Boolean(props.state.googleConfirm)}
        >
          {props.state.saving ? language.t("secondBrain.saving") : language.t("common.save")}
        </ButtonV2>
      </div>
    </form>
  )
}
