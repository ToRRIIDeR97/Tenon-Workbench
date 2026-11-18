/** How a thread's last unseen turn ended, for the sidebar mark beside it until the thread is opened. */
export type FinishMark = "failed" | "reply" | "done"

/**
 * True when the reply ends by asking the user something: its last paragraph, outside code, ends in a question
 * mark. Agents that ask in plain text (rather than through the question tool) end their turn waiting on an answer.
 */
export function asksUser(text: string) {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, "").trim()
  const last =
    prose
      .split(/\n\s*\n/)
      .at(-1)
      ?.trim() ?? ""
  // Trailing emphasis, quotes and brackets don't change what the sentence ends with.
  return /[?？]$/.test(last.replace(/[*_`"'”’)\]\s]+$/, ""))
}

/**
 * Whether a finished turn asked the user something, for a thread whose reply may not be in memory: reads it, else
 * loads the last messages (`load`) and reads again. The load gets at most `timeout` ms, so a slow or stuck server
 * never holds back the finish mark; a load that fails or runs out reads as not asking (the mark then says Done),
 * which is the safe side: Done never hides an approval, and opening the thread shows the question.
 */
export async function replyAsks(input: { read: () => string; load: () => Promise<unknown>; timeout?: number }) {
  const loaded = input.read()
  if (loaded) return asksUser(loaded)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    // Also a load that throws before returning its promise.
    Promise.resolve()
      .then(input.load)
      .catch(() => undefined),
    new Promise((resolve) => (timer = setTimeout(resolve, input.timeout ?? 2_000))),
  ])
  clearTimeout(timer)
  return asksUser(input.read())
}

export function finishMark(input: { unseen: number; error: boolean; asks: boolean }): FinishMark | undefined {
  if (input.unseen === 0) return undefined
  if (input.error) return "failed"
  return input.asks ? "reply" : "done"
}
