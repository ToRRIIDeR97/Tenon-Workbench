/** A passage of an assistant reply the user answers, and what they wrote about it (if anything). */
export type QuoteNote = { text: string; reply?: string }

const HEADER = "The user is replying to this passage from your earlier message:"
const REPLY = "Their reply: "

/** Sent as a synthetic text part's metadata, so the user message can show the passage and reply without parsing. */
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

/**
 * What the model reads: the passage as a Markdown quote, so it knows which part the user's message answers, and the
 * user's reply to that passage when they wrote one for it.
 */
export function formatQuoteNote(text: string, reply?: string) {
  const quoted = text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
  const answer = reply?.trim()
  return `${HEADER}\n\n${quoted}${answer ? `\n\n${REPLY}${answer}` : ""}`
}

/**
 * Splits quote notes back out of a message's text. External harnesses receive the prompt as one text, so their
 * user messages hold the notes inline after what the user typed; this recovers both for display.
 */
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
