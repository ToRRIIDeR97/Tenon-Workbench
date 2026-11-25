import { pathKey } from "@/utils/path-key"

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

export function threadUsage<T extends { instanceID: string; status: string }>(
  reports: ReadonlyArray<T>,
  current: string | undefined,
) {
  return reports.find((item) => item.instanceID === current && item.status !== "unsupported")
}

export function formatResetIn(resetsAt: number, now: number, locale: string) {
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000))
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
  if (minutes < 60) return format.format(minutes, "minute")
  if (minutes < 48 * 60) return format.format(Math.round(minutes / 60), "hour")
  return format.format(Math.round(minutes / (24 * 60)), "day")
}

const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() || directory
