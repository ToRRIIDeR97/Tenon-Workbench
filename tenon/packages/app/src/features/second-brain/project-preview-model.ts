// What the Projects page's preview pane shows for a Project (project-preview.tsx), kept free of UI imports for tests.
import type { ProjectRecord, TimelineItem } from "./client"

const OPEN_TASKS = 5

/**
 * The next milestone (the Project's own `nextMilestone`, else its first unfinished milestone item and that item's
 * date), the open tasks with the ones in progress first, and how many tasks are done.
 */
export function previewSummary(record: Pick<ProjectRecord, "nextMilestone">, items: ReadonlyArray<TimelineItem>) {
  const milestone = items.find((item) => item.kind === "milestone" && item.status !== "done")
  const named = record.nextMilestone?.trim()
  const tasks = items.filter((item) => item.kind === "task")
  return {
    next: named
      ? { title: named, date: milestone?.title === named ? (milestone.start ?? milestone.end) : undefined }
      : milestone && { title: milestone.title, date: milestone.start ?? milestone.end },
    open: tasks
      .filter((item) => item.status !== "done")
      .toSorted((a, b) => Number(b.status === "doing") - Number(a.status === "doing"))
      .slice(0, OPEN_TASKS),
    done: tasks.filter((item) => item.status === "done").length,
    total: tasks.length,
  }
}
