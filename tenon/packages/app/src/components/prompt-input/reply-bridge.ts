import type { ContextItem, Prompt } from "@/context/prompt"

/** A reply to a passage of the thread: what the user wrote and the passage it quotes. */
export type PromptReply = { text: string; quote: string }

/**
 * The prompt and context a reply sends: no typed text, and the passage as a quote that carries the reply, so the
 * message shows the passage and its answer together.
 */
export function replySubmission(reply: PromptReply): { prompt: Prompt; context: (ContextItem & { key: string })[] } {
  return {
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    context: [
      {
        type: "quote",
        text: reply.quote,
        comment: reply.text,
        key: `reply:${reply.quote.length}:${reply.quote.slice(0, 32)}`,
      },
    ],
  }
}

/** How the thread composer takes a reply: `send` posts it now, `add` keeps it as a chip to send with the draft. */
type ReplySender = { send: (reply: PromptReply) => void; add: (reply: PromptReply) => void }

const senders: ReplySender[] = []

/**
 * The thread composer registers how it sends, so the reply card over the timeline can send through the same path
 * (harness, model, follow-up delivery) without the card and the composer sharing a component tree.
 * Returns the unregister function.
 */
export function registerReplySender(sender: ReplySender) {
  senders.push(sender)
  return () => {
    const index = senders.lastIndexOf(sender)
    if (index >= 0) senders.splice(index, 1)
  }
}

/** Sends a reply through the most recently mounted thread composer. False when no composer is mounted. */
export function sendReply(reply: PromptReply) {
  const sender = senders.at(-1)
  if (!sender) return false
  sender.send(reply)
  return true
}

/** Adds a reply to the most recently mounted thread composer as a chip. False when no composer is mounted. */
export function addReply(reply: PromptReply) {
  const sender = senders.at(-1)
  if (!sender) return false
  sender.add(reply)
  return true
}
