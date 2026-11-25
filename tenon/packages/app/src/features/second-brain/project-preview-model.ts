import type { ProjectRecord, TimelineItem } from "./client"

const OPEN_TASKS = 5

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
