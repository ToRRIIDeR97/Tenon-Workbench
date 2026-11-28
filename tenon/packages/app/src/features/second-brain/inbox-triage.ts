export type InboxEntry = { id: string; label: string; at: string; text: string; start: number; end: number }

const ENTRY = /^## (.+?) · (\d{4}-\d{2}-\d{2}T[0-9:.]+Z)[ \t]*\r?$/gm
const HEADING = /^## /gm

export function parseInbox(body: string): InboxEntry[] {
  const headings = [...body.matchAll(HEADING)].map((match) => match.index ?? 0)
  return [...body.matchAll(ENTRY)].map((match, position) => {
    const start = match.index ?? 0
    const end = headings.find((index) => index > start) ?? body.length
    return {
      id: `${position}:${match[2]}`,
      label: match[1]!.trim(),
      at: match[2]!,
      text: body
        .slice(start + match[0].length, end)
        .replace(/\r\n/g, "\n")
        .trim(),
      start,
      end,
    }
  })
}

export function removeInboxEntry(body: string, id: string) {
  const entry = parseInbox(body).find((item) => item.id === id)
  if (!entry) return body
  const before = body.slice(0, entry.start).replace(/\s+$/, "")
  const after = body.slice(entry.end).replace(/^\s+/, "")
  if (!before) return after
  return after ? `${before}\n\n${after}` : `${before}\n`
}

export function inboxNewestFirst(entries: ReadonlyArray<InboxEntry>) {
  return [...entries].sort((left, right) => right.at.localeCompare(left.at) || right.start - left.start)
}

export function inboxTaskTitle(text: string) {
  const line = text.split("\n").find((item) => item.trim()) ?? ""
  const title = line.replace(/^[-*]\s+(\[[ x]\]\s+)?/i, "").trim()
  return title.length > 120 ? `${title.slice(0, 119)}…` : title
}
