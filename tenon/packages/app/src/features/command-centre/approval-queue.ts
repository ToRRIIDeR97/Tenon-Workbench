export type QueueItem = {
  kind: "permission" | "question"
  sessionID: string
  requestID: string
  title: string
  project: string
  asked: number
}

type Pending = ReadonlyArray<{ id: string; time?: { created?: number } }> | undefined

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
