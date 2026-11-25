import type { ContextItem, Prompt } from "@/context/prompt"

export type PromptReply = { text: string; quote: string }

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

type ReplySender = { send: (reply: PromptReply) => void; add: (reply: PromptReply) => void; submit: () => void }

const senders: ReplySender[] = []

export function registerReplySender(sender: ReplySender) {
  senders.push(sender)
  return () => {
    const index = senders.lastIndexOf(sender)
    if (index >= 0) senders.splice(index, 1)
  }
}

export function sendReply(reply: PromptReply) {
  const sender = senders.at(-1)
  if (!sender) return false
  sender.send(reply)
  return true
}

export function submitComposer() {
  const sender = senders.at(-1)
  if (!sender) return false
  sender.submit()
  return true
}

export function addReply(reply: PromptReply) {
  const sender = senders.at(-1)
  if (!sender) return false
  sender.add(reply)
  return true
}
