/**
 * What the Command Centre hub shows, worked out from plain data so the views stay thin: a card per Project
 * (Hub), and a Project's crew, its Command Centre lead and the agents working in it (Project view).
 */

/** The thread that started a session without being its parent: a delegated task placed in a Project. */
export type Origin = { sessionID: string; commandCentre: boolean }
export type TodoItem = { content: string; status: string }
export type HarnessModelRef = { id: string; reasoningEffort?: string }
export type ModelCatalogue = { models: ReadonlyArray<{ id: string; name: string }> }

export type HubThreadState = "needs" | "running" | "idle"
/** A Project's root thread, as the hub reads it. */
export type HubThread = {
  id: string
  title: string
  harness: string
  model?: HarnessModelRef
  updated: number
  state: HubThreadState
  waiting: number
  origin?: Origin
  todos?: ReadonlyArray<TodoItem>
}
export type HubProject = {
  id: string
  name: string
  outcome: string
  status: "active" | "paused" | "archived"
  progressPercent: number
  nextMilestone?: string | null
}
export type HubCardState = "needs" | "running" | "paused" | "idle"
export type HubCard = {
  id: string
  name: string
  outcome: string
  milestone?: string
  progress: number
  state: HubCardState
  working: number
  needs: number
  /** Harness IDs in the Project: the Command Centre's first when it started one of its threads. */
  harnesses: string[]
  /** One of the Project's threads was started by the Command Centre. */
  commandCentre: boolean
  /** The line under the card: the most recently updated running thread, else the newest thread. */
  now?: { id: string; title: string; harness: string; updated: number }
}
export type CrewAgent = {
  id: string
  title: string
  harness: string
  model?: string
  state: "needs" | "running" | "done"
  step?: { n: number; of: number; text: string }
  commandCentre: boolean
  updated: number
}
export type CrewLead = { id: string; title: string; harness: string; model?: string }

/** Idle threads stay in a Project's crew this long after their last change. */
export const RECENT_MS = 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A session's origin, from the V2 `origin` field or the V1 `metadata.origin`; undefined when missing or malformed. */
export function sessionOrigin(session: unknown): Origin | undefined {
  if (!isRecord(session)) return undefined
  const value = session.origin ?? (isRecord(session.metadata) ? session.metadata.origin : undefined)
  if (!isRecord(value)) return undefined
  if (typeof value.sessionID !== "string" || !value.sessionID || typeof value.commandCentre !== "boolean")
    return undefined
  return { sessionID: value.sessionID, commandCentre: value.commandCentre }
}

/**
 * A session's harness and model. Normalized sessions carry them as fields; the sidebar's lists can carry them only in
 * `metadata`, as v1 events do.
 */
export function sessionHarness(session: unknown, fallback: string): { harness: string; model?: HarnessModelRef } {
  if (!isRecord(session)) return { harness: fallback }
  const metadata = isRecord(session.metadata) ? session.metadata : {}
  const harness = [session.harnessInstanceID, metadata.harnessInstanceID].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const model = [session.harnessModel, metadata.harnessModel].find(
    (value): value is HarnessModelRef => isRecord(value) && typeof value.id === "string",
  )
  return {
    harness: harness ?? fallback,
    ...(model
      ? {
          model: {
            id: model.id,
            ...(typeof model.reasoningEffort === "string" ? { reasoningEffort: model.reasoningEffort } : {}),
          },
        }
      : {}),
  }
}

/**
 * Where a thread is in its checklist: the item in progress (1-based), else how many are done and the last one done,
 * else nothing started and the first item. Every item counts toward `of`, cancelled ones too.
 */
export function todoStep(todos: ReadonlyArray<TodoItem> | undefined) {
  if (!todos?.length) return undefined
  const active = todos.findIndex((todo) => todo.status === "in_progress")
  if (active >= 0) return { n: active + 1, of: todos.length, text: todos[active]!.content }
  const done = todos.filter((todo) => todo.status === "completed")
  if (done.length) return { n: done.length, of: todos.length, text: done.at(-1)!.content }
  return { n: 0, of: todos.length, text: todos[0]!.content }
}

/** The model's name as its harness lists it (else the id after its last `/`), with the reasoning effort. */
export function modelLabel(model: HarnessModelRef | undefined, catalogue?: ModelCatalogue) {
  if (!model) return undefined
  const name = catalogue?.models.find((item) => item.id === model.id)?.name ?? model.id.split("/").at(-1) ?? model.id
  const effort = model.reasoningEffort?.trim()
  return effort ? `${name} · ${effort.charAt(0).toUpperCase()}${effort.slice(1)}` : name
}

const newestFirst = <T extends { updated: number }>(items: ReadonlyArray<T>) =>
  items.toSorted((left, right) => right.updated - left.updated)

/** A card per Project that isn't archived, in the order given. */
export function hubCards(input: {
  projects: ReadonlyArray<HubProject>
  threads: Readonly<Record<string, ReadonlyArray<HubThread> | undefined>>
  /** The harness the Command Centre runs on, shown first on Projects it works in. */
  commandCentreHarness?: string
}): HubCard[] {
  return input.projects
    .filter((project) => project.status !== "archived")
    .map((project) => {
      const threads = newestFirst(input.threads[project.id] ?? [])
      const needs = threads.filter((thread) => thread.state === "needs").length
      const running = threads.filter((thread) => thread.state === "running")
      const commandCentre = threads.some((thread) => thread.origin?.commandCentre === true)
      const harnesses = [
        ...(commandCentre && input.commandCentreHarness ? [input.commandCentreHarness] : []),
        ...threads.filter((thread) => thread.state !== "idle").map((thread) => thread.harness),
      ].filter((harness, index, all) => all.indexOf(harness) === index)
      const line = running[0] ?? threads[0]
      return {
        id: project.id,
        name: project.name,
        outcome: project.outcome,
        milestone: project.nextMilestone ?? undefined,
        progress: project.progressPercent,
        state: needs > 0 ? "needs" : running.length > 0 ? "running" : project.status === "paused" ? "paused" : "idle",
        working: running.length,
        needs,
        harnesses,
        commandCentre,
        now: line ? { id: line.id, title: line.title, harness: line.harness, updated: line.updated } : undefined,
      } satisfies HubCard
    })
}

/**
 * A Project's crew: the Command Centre thread that most recently started work here (when the caller knows it), and
 * the threads that need you, run, or changed in the last day, newest first.
 */
export function projectCrew(input: {
  now: number
  threads: ReadonlyArray<HubThread>
  commandCentre: ReadonlyArray<{ id: string; title: string; harness: string; model?: HarnessModelRef }>
  instances?: Readonly<Record<string, ModelCatalogue | undefined>>
}): { lead?: CrewLead; agents: CrewAgent[] } {
  const sorted = newestFirst(input.threads)
  const started = sorted.find((thread) => thread.origin?.commandCentre === true)?.origin?.sessionID
  const lead = started ? input.commandCentre.find((thread) => thread.id === started) : undefined
  return {
    lead: lead
      ? {
          id: lead.id,
          title: lead.title,
          harness: lead.harness,
          model: modelLabel(lead.model, input.instances?.[lead.harness]),
        }
      : undefined,
    agents: sorted
      .filter((thread) => thread.state !== "idle" || input.now - thread.updated <= RECENT_MS)
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        harness: thread.harness,
        model: modelLabel(thread.model, input.instances?.[thread.harness]),
        state: thread.state === "idle" ? "done" : thread.state,
        step: todoStep(thread.todos),
        commandCentre: thread.origin?.commandCentre === true,
        updated: thread.updated,
      })),
  }
}
