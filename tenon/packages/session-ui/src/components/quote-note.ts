export type QuoteNote = { text: string; reply?: string }

const HEADER = "The user is replying to this passage from your earlier message:"
const REPLY = "Their reply: "

export function createQuoteMetadata(text: string, reply?: string) {
  const answer = reply?.trim()
  return { tenonQuote: answer ? { text, reply: answer } : { text } }
}

export function readQuoteMetadata(value: unknown): QuoteNote | undefined {
  if (!value || typeof value !== "object") return
  const meta = (value as { tenonQuote?: unknown }).tenonQuote
  if (!meta || typeof meta !== "object") return
  const text = (meta as { text?: unknown }).text
  const reply = (meta as { reply?: unknown }).reply
  if (typeof text !== "string" || !text.trim()) return
  return typeof reply === "string" && reply.trim() ? { text, reply } : { text }
}

export function formatQuoteNote(text: string, reply?: string) {
  const quoted = text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
  const answer = reply?.trim()
  return `${HEADER}\n\n${quoted}${answer ? `\n\n${REPLY}${answer}` : ""}`
}

export function splitQuoteNotes(message: string): { text: string; quotes: QuoteNote[] } {
  const [head = "", ...notes] = message.split(new RegExp(`(?:^|\\r?\\n)${escape(HEADER)}\\r?\\n\\r?\\n`))
  if (notes.length === 0) return { text: message, quotes: [] }
  const quotes = notes.flatMap((note): QuoteNote[] => {
    const lines = note.split(/\r?\n/)
    const quoted = lines.findIndex((line) => !line.startsWith(">"))
    const passage = (quoted === -1 ? lines : lines.slice(0, quoted)).map((line) => line.replace(/^> ?/, "")).join("\n")
    const rest = (quoted === -1 ? "" : lines.slice(quoted).join("\n")).trim()
    if (!passage.trim()) return []
    return [rest.startsWith(REPLY) ? { text: passage, reply: rest.slice(REPLY.length).trim() } : { text: passage }]
  })
  return { text: head.trim(), quotes }
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
