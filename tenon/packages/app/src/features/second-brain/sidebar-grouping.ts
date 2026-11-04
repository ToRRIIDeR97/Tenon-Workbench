import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { agentRunStatus } from "@/pages/activity-runs"
import { flattenThreads, type SidebarSession, type ThreadNode } from "./sidebar-threads"

export type ThreadGrouping = "project" | "attention" | "recent"
export type ThreadState = "approval" | "running" | "idle"
export type CardSummary = { running: number; approvals: number; total: number }
export type ThreadCard<S extends SidebarSession = SidebarSession> = {
  id: string
  threads: ThreadNode<S>[]
  summary: CardSummary
}

/** A thread's state known only through parent links, because the thread itself isn't in the tree. */
export type LinkedState = { id: string; state: ThreadState }
type LinkedStates<S> = (session: S) => LinkedState[]

/** Stored values come from disk, so anything unknown falls back to Project. */
export function parseGrouping(value: unknown): ThreadGrouping {
  return value === "attention" || value === "recent" ? value : "project"
}

/** A retrying run is still running; a pending approval outranks both. */
export function threadState(status: SessionStatus | undefined, approvals: number): ThreadState {
  const run = agentRunStatus(status, approvals)
  if (run === "approval") return "approval"
  return run ? "running" : "idle"
}

/** The most urgent state in a thread's subtree, including descendants reachable only through `linked`. */
export function nodeState<S extends SidebarSession>(
  node: ThreadNode<S>,
  stateOf: (session: S) => ThreadState,
  linked?: LinkedStates<S>,
): ThreadState {
  const states = subtreeStates([node], stateOf, linked)
  if (states.includes("approval")) return "approval"
  return states.includes("running") ? "running" : "idle"
}

/** Running and approval count every thread in the subtrees; `total` counts root nodes. */
export function cardSummary<S extends SidebarSession>(
  nodes: readonly ThreadNode<S>[],
  stateOf: (session: S) => ThreadState,
  linked?: LinkedStates<S>,
): CardSummary {
  const states = subtreeStates(nodes, stateOf, linked)
  return {
    running: states.filter((state) => state === "running").length,
    approvals: states.filter((state) => state === "approval").length,
    total: nodes.length,
  }
}

/** Needs you, Running and Other threads. A root sits where its most urgent descendant puts it. */
export function attentionCards<S extends SidebarSession>(
  roots: readonly ThreadNode<S>[],
  stateOf: (session: S) => ThreadState,
  linked?: LinkedStates<S>,
): ThreadCard<S>[] {
  const inState = (state: ThreadState) => roots.filter((node) => nodeState(node, stateOf, linked) === state)
  return nonEmptyCards(
    [
      ["attention:needs", inState("approval")],
      ["attention:running", inState("running")],
      ["attention:other", inState("idle")],
    ],
    stateOf,
    linked,
  )
}

/** Today, Yesterday and Earlier by local calendar day. A clock-skewed future update counts as Today. */
export function recentCards<S extends SidebarSession>(
  roots: readonly ThreadNode<S>[],
  stateOf: (session: S) => ThreadState,
  now: number,
  linked?: LinkedStates<S>,
): ThreadCard<S>[] {
  const date = new Date(now)
  // Built from calendar fields so a daylight saving change can't move the day boundaries.
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const yesterday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime()
  const updated = (node: ThreadNode<S>) => lastUpdate(node.session)
  return nonEmptyCards(
    [
      ["recent:today", roots.filter((node) => updated(node) >= today)],
      ["recent:yesterday", roots.filter((node) => updated(node) >= yesterday && updated(node) < today)],
      ["recent:earlier", roots.filter((node) => updated(node) < yesterday)],
    ],
    stateOf,
    linked,
  )
}

/**
 * Every working thread listed under each of its ancestors, by following child-to-parent links. Idle threads
 * are skipped, so the cost follows what's running rather than how many threads exist.
 */
export function linkedStates(
  ids: Iterable<string>,
  parents: Record<string, string>,
  stateOf: (id: string) => ThreadState,
) {
  const result = new Map<string, LinkedState[]>()
  for (const id of new Set(ids)) {
    const state = stateOf(id)
    if (state === "idle") continue
    const seen = new Set([id])
    for (let parent = parents[id]; parent && !seen.has(parent); parent = parents[parent]) {
      seen.add(parent)
      result.set(parent, [...(result.get(parent) ?? []), { id, state }])
    }
  }
  return result
}

export const lastUpdate = (session: SidebarSession) => session.time.updated ?? session.time.created

/** Attention and Recent cards open by default; Project and workspace groups keep their own default. */
export const isGroupingCard = (id: string) => /^(attention|recent):/.test(id)

/** A loaded thread counts once however it's reached, so expanding a Project can't change the result. */
function subtreeStates<S extends SidebarSession>(
  nodes: readonly ThreadNode<S>[],
  stateOf: (session: S) => ThreadState,
  linked?: LinkedStates<S>,
) {
  const loaded = flattenThreads(nodes)
  const ids = new Set(loaded.map((session) => session.id))
  const unloaded = new Map(
    nodes
      .flatMap((node) => linked?.(node.session) ?? [])
      .filter((item) => !ids.has(item.id))
      .map((item) => [item.id, item.state] as const),
  )
  return [...loaded.map((session) => stateOf(session)), ...unloaded.values()]
}

function nonEmptyCards<S extends SidebarSession>(
  buckets: [id: string, threads: ThreadNode<S>[]][],
  stateOf: (session: S) => ThreadState,
  linked?: LinkedStates<S>,
): ThreadCard<S>[] {
  return buckets
    .filter(([, threads]) => threads.length > 0)
    .map(([id, threads]) => ({ id, threads, summary: cardSummary(threads, stateOf, linked) }))
}
