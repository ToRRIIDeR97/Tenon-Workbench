/** One thing a thread is waiting on the user for: a permission request or a question. */
export type QueueItem = {
  kind: "permission" | "question"
  sessionID: string
  requestID: string
  title: string
  /** Display name of the Project. */
  project: string
  /** When it was asked, in ms; 0 when the request carries no time. */
  asked: number
}

type Pending = ReadonlyArray<{ id: string; time?: { created?: number } }> | undefined

/**
 * Every pending permission and question of the given threads as one queue, oldest first. On a tie permissions
 * come before questions, then the threads' order. Requests of threads that were not given are ignored.
 */
export function approvalQueue(
  threads: { id: string; title: string; project: string }[],
  data: { permission: Record<string, Pending>; question: Record<string, Pending> },
): QueueItem[] {
  const items = threads.flatMap((thread) =>
    (["permission", "question"] as const).flatMap((kind) =>
      (data[kind][thread.id] ?? []).map(
        (request): QueueItem => ({
          kind,
          sessionID: thread.id,
          requestID: request.id,
          title: thread.title,
          project: thread.project,
          asked: request.time?.created ?? 0,
        }),
      ),
    ),
  )
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        a.item.asked - b.item.asked ||
        Number(a.item.kind === "question") - Number(b.item.kind === "question") ||
        a.index - b.index,
    )
    .map((entry) => entry.item)
}
