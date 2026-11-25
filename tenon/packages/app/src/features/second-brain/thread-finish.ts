export type FinishMark = "failed" | "reply" | "done"

export function asksUser(text: string) {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, "").trim()
  const last =
    prose
      .split(/\n\s*\n/)
      .at(-1)
      ?.trim() ?? ""
  return /[?？]$/.test(last.replace(/[*_`"'”’)\]\s]+$/, ""))
}

export async function replyAsks(input: { read: () => string; load: () => Promise<unknown>; timeout?: number }) {
  const loaded = input.read()
  if (loaded) return asksUser(loaded)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
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
