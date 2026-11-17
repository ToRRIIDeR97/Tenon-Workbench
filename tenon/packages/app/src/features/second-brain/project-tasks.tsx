import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { focusWhenConnected } from "@/utils/focus-when-connected"
import { showToast } from "@/utils/toast"
import type { TimelineItem } from "./client"
import { dueDatePatch, milestoneStatus, restoreItem, type MilestoneGroup } from "./notes-timeline"
import { DateChip, StatusMenu } from "./project-controls"

/**
 * A Project's task edits: check off, status, due date, rename and delete, each saved as the whole item list
 * through `onSaveItems`, with Undo for a completion or a delete. Shared by the Project page and the Projects
 * page's detail card, so a task row works the same in both.
 */
export function createProjectTasks(props: {
  items: () => ReadonlyArray<TimelineItem>
  /** Saves the whole item list over the loaded revision; resolves to an error message, or "" when saved. */
  onSaveItems: (items: ReadonlyArray<TimelineItem>) => Promise<string>
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    saving: false,
    error: "",
    /** The item whose title is being edited in its row. */
    renaming: "",
  })
  const save = async (next: ReadonlyArray<TimelineItem>) => {
    if (state.saving) return false
    setState({ saving: true, error: "" })
    const error = await props.onSaveItems(next)
    setState({ saving: false, error })
    return !error
  }
  // Saves replace the whole list, so every change and Undo starts from the latest items, not a captured array.
  const update = (id: string, patch: Partial<TimelineItem>) =>
    save(props.items().map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const undoToast = (description: string, undo: () => void) =>
    showToast({ description, actions: [{ label: language.t("secondBrain.sidebar.undo"), onClick: undo }] })
  const setStatus = async (item: TimelineItem, status: TimelineItem["status"]) => {
    const { id, title, status: previous } = item
    if (!(await update(id, { status })) || status !== "done") return
    undoToast(language.t("secondBrain.tasks.completed", { title }), () => void update(id, { status: previous }))
  }
  const remove = async (item: TimelineItem) => {
    const removed = { ...item }
    const index = props.items().findIndex((entry) => entry.id === item.id)
    if (!(await save(props.items().filter((entry) => entry.id !== item.id)))) return
    undoToast(language.t("secondBrain.project.itemDeleted", { title: removed.title }), () => {
      void save(restoreItem(props.items(), removed, index))
    })
  }
  const finishRename = (item: TimelineItem, value: string | undefined) => {
    if (state.renaming !== item.id) return
    setState("renaming", "")
    const title = value?.trim()
    if (title && title !== item.title) void update(item.id, { title })
  }
  // A rename picked from the menu shows its input once the menu has closed: closing returns focus to the trigger.
  const menu = { renaming: "" }
  return { state, setState, save, update, setStatus, remove, finishRename, menu }
}

export type ProjectTasks = ReturnType<typeof createProjectTasks>

// A task's date is its due day (end); a milestone's is its day (start).
const dueOf = (item: TimelineItem) => (item.kind === "milestone" ? item.start : (item.end ?? item.start))

/** A task line, or a milestone's heading line with its tasks' "n of m done". */
export function ProjectTaskRow(props: { tasks: ProjectTasks; item: TimelineItem; group?: MilestoneGroup }) {
  const language = useLanguage()
  const tasks = props.tasks
  // A milestone reads as done once every task under it is.
  const status = () => (props.group && milestoneStatus(props.group)) || props.item.status
  return (
    <div
      data-task={props.item.id}
      data-kind={props.item.kind}
      data-status={status()}
      classList={{
        "flex items-center gap-3 px-4": true,
        "min-h-11": props.item.kind === "milestone",
        "min-h-10": props.item.kind === "task",
      }}
    >
      <Show
        when={props.item.kind === "task"}
        fallback={
          <span aria-hidden="true" class="flex w-4 shrink-0 justify-center text-v2-icon-icon-accent">
            ◆
          </span>
        }
      >
        <CheckboxV2
          hideLabel
          shape="round"
          label={props.item.title}
          checked={props.item.status === "done"}
          disabled={tasks.state.saving}
          onChange={(checked) => void tasks.setStatus(props.item, checked ? "done" : "todo")}
        />
      </Show>
      <Show
        when={tasks.state.renaming === props.item.id}
        fallback={
          // A button, so rename is one click or Enter away from the keyboard too.
          <button
            type="button"
            title={props.item.title}
            aria-label={language.t("secondBrain.project.renameItem", { title: props.item.title })}
            disabled={tasks.state.saving}
            classList={{
              "min-w-0 flex-1 truncate rounded-[8px] text-left type-row-title focus-visible:outline-offset-2": true,
              "text-v2-text-text-muted line-through": status() === "done",
              "text-v2-text-text-base": status() !== "done",
            }}
            onClick={() => tasks.setState("renaming", props.item.id)}
          >
            {props.item.title}
          </button>
        }
      >
        <input
          ref={focusWhenConnected}
          class="h-7 min-w-0 flex-1 rounded-full bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_1px_var(--v2-border-border-base)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
          aria-label={language.t("secondBrain.project.renameItem", { title: props.item.title })}
          maxLength={200}
          value={props.item.title}
          onKeyDown={(event) => {
            if (event.isComposing) return
            if (event.key === "Enter") tasks.finishRename(props.item, event.currentTarget.value)
            if (event.key === "Escape") tasks.finishRename(props.item, undefined)
          }}
          onBlur={(event) => tasks.finishRename(props.item, event.currentTarget.value)}
        />
      </Show>
      <Show when={props.group && props.group.total > 0 ? props.group : undefined}>
        {(group) => (
          <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">
            {language.t("secondBrain.project.milestoneDone", { done: group().done, total: group().total })}
          </span>
        )}
      </Show>
      <StatusMenu
        value={status()}
        label={language.t("secondBrain.project.statusOf", { title: props.item.title })}
        disabled={tasks.state.saving}
        onChange={(next) => void tasks.setStatus(props.item, next)}
      />
      <DateChip
        value={dueOf(props.item)?.slice(0, 10)}
        label={language.t("secondBrain.project.dueDateOf", { title: props.item.title })}
        disabled={tasks.state.saving}
        onChange={(date) => void tasks.update(props.item.id, dueDatePatch(props.item, date))}
      />
      <MenuV2 gutter={4} modal={false} placement="bottom-end">
        <MenuV2.Trigger
          as={IconButtonV2}
          variant="ghost-muted"
          size="small"
          disabled={tasks.state.saving}
          icon={<Icon name="outline-dots" size="small" />}
          aria-label={language.t("secondBrain.project.itemActions", { title: props.item.title })}
        />
        <MenuV2.Portal>
          <MenuV2.Content
            onCloseAutoFocus={() => {
              if (tasks.menu.renaming !== props.item.id) return
              tasks.menu.renaming = ""
              // Kobalte focuses the trigger right after this handler, so the input opens after it.
              queueMicrotask(() => tasks.setState("renaming", props.item.id))
            }}
          >
            <MenuV2.Item onSelect={() => (tasks.menu.renaming = props.item.id)}>
              {language.t("common.rename")}
            </MenuV2.Item>
            <MenuV2.Item onSelect={() => void tasks.remove(props.item)}>{language.t("common.delete")}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </div>
  )
}
