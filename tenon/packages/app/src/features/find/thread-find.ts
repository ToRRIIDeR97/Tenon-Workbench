import { countMatches } from "./find-text"

export type ThreadFindMessage = { id: string; role: "user" | "assistant"; parentID?: string }
export type ThreadFindPart = { type: string; text?: string; synthetic?: boolean; ignored?: boolean }
export type ThreadFindTurn = { turnID: string; texts: string[] }
export type ThreadFindMatch = { turnID: string; occurrence: number }

const visibleText = (parts: ReadonlyArray<ThreadFindPart> | undefined) =>
  (parts ?? []).flatMap((part) =>
    part.type === "text" && !part.synthetic && !part.ignored && typeof part.text === "string" && part.text
      ? [part.text]
      : [],
  )

export function threadFindTurns(
  messages: ReadonlyArray<ThreadFindMessage>,
  parts: Readonly<Record<string, ReadonlyArray<ThreadFindPart> | undefined>>,
): ThreadFindTurn[] {
  const turns = new Map<string, string[]>()
  for (const message of messages) if (message.role === "user") turns.set(message.id, visibleText(parts[message.id]))
  for (const message of messages) {
    if (message.role !== "assistant" || !message.parentID) continue
    turns.get(message.parentID)?.push(...visibleText(parts[message.id]))
  }
  return [...turns].map(([turnID, texts]) => ({ turnID, texts }))
}

export function threadFindMatches(turns: ReadonlyArray<ThreadFindTurn>, query: string): ThreadFindMatch[] {
  if (!query.trim()) return []
  return turns.flatMap((turn) => {
    const count = turn.texts.reduce((total, text) => total + countMatches(text, query), 0)
    return Array.from({ length: count }, (_, occurrence) => ({ turnID: turn.turnID, occurrence }))
  })
}
