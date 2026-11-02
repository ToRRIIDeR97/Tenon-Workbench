import { pathKey } from "@/utils/path-key"

/**
 * The folder a thread runs in, named after its last path segment. It is a linked worktree when the project
 * lists it among its sandboxes (the Git worktrees beside the main checkout); the main checkout and folders
 * outside Git are plain folders.
 */
export function threadWorktree(input: {
  directory: string | undefined
  project: { worktree: string; sandboxes?: readonly string[] } | undefined
}) {
  const directory = input.directory
  if (!directory) return undefined
  const key = pathKey(directory)
  const linked =
    !!input.project &&
    pathKey(input.project.worktree) !== key &&
    !!input.project.sandboxes?.some((sandbox) => pathKey(sandbox) === key)
  return { name: folderName(directory), linked }
}

/** The thread's own harness report for the sheet, or undefined when that harness doesn't report usage. */
export function threadUsage<T extends { instanceID: string; status: string }>(
  reports: ReadonlyArray<T>,
  current: string | undefined,
) {
  return reports.find((item) => item.instanceID === current && item.status !== "unsupported")
}

/** How far off a usage window's reset is, as a locale's relative time ("in 3 hours"), in the largest whole unit. */
export function formatResetIn(resetsAt: number, now: number, locale: string) {
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000))
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
  if (minutes < 60) return format.format(minutes, "minute")
  if (minutes < 48 * 60) return format.format(Math.round(minutes / 60), "hour")
  return format.format(Math.round(minutes / (24 * 60)), "day")
}

const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() || directory
