import type { SubagentGroup } from "@/components/session/subagent-list"

/** A thread folder shortened for one line: the home folder becomes `~`, separators are `/`. */
export function shortFolder(directory: string | undefined, home: string | undefined) {
  if (!directory) return ""
  const normal = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const base = home?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (base && normal.toLowerCase().startsWith(base.toLowerCase() + "/")) return `~${normal.slice(base.length)}`
  return normal
}

/** The thread's file changes in one line: how many files and the added and removed lines. */
export function changeTotals(diffs: ReadonlyArray<{ additions: number; deletions: number }> | undefined) {
  const list = diffs ?? []
  return {
    files: list.length,
    additions: list.reduce((sum, diff) => sum + diff.additions, 0),
    deletions: list.reduce((sum, diff) => sum + diff.deletions, 0),
  }
}

/**
 * The MCP servers a thread can use, as the popover lists them: the user's servers from Settings (on or off), and
 * for Codex and the ACP agents Tenon's own `tenon` server (delegation, questions, notes), which they always get.
 */
export function connectorRows(
  config: Record<string, { type?: string; enabled?: boolean }> | undefined,
  external: boolean,
) {
  const own = Object.entries(config ?? {})
    .filter(([, entry]) => entry.type === "local" || entry.type === "remote")
    .map(([name, entry]) => ({ name, on: entry.enabled !== false, builtIn: false }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
  return external ? [{ name: "tenon", on: true, builtIn: true }, ...own] : own
}

/** Subagents still working in the thread's latest groups. */
export function runningSubagents(groups: ReadonlyArray<SubagentGroup>) {
  return groups
    .flatMap((group) => group.items)
    .filter((item) => item.part.state.status === "pending" || item.part.state.status === "running").length
}
