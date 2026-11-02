/** The passage of an assistant reply the user answers, sent as a synthetic text part with this metadata. */
export function createQuoteMetadata(text: string) {
  return { tenonQuote: { text } }
}

export function readQuoteMetadata(value: unknown) {
  if (!value || typeof value !== "object") return
  const meta = (value as { tenonQuote?: unknown }).tenonQuote
  if (!meta || typeof meta !== "object") return
  const text = (meta as { text?: unknown }).text
  return typeof text === "string" && text.trim() ? text : undefined
}

/** What the model reads: the passage as a Markdown quote, so it knows which part the user's message answers. */
export function formatQuoteNote(text: string) {
  const quoted = text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
  return `The user is replying to this passage from your earlier message:\n\n${quoted}`
}
