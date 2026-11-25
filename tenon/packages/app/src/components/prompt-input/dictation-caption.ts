const MAX_SKIPPED = 3
const MIN_RUN = 3

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")

export function mergeCaption(previous: string, next: string) {
  const before = previous.split(/\s+/).filter(Boolean)
  const after = next.split(/\s+/).filter(Boolean)
  if (before.length === 0 || after.length === 0) return next.trim()
  const a = before.map(norm)
  const b = after.map(norm)
  let best: { i: number; j: number; run: number; score: number } | undefined
  for (let j = 0; j <= Math.min(MAX_SKIPPED, b.length - 1); j++) {
    for (let i = 0; i < a.length; i++) {
      if (!a[i] || a[i] !== b[j]) continue
      let run = 0
      while (i + run < a.length && j + run < b.length && a[i + run] === b[j + run]) run++
      const needed = i === 0 ? Math.min(MIN_RUN, a.length, b.length - j) : Math.min(MIN_RUN, b.length - j)
      if (run < needed) continue
      const score = run + (i + run === a.length ? a.length : 0)
      if (!best || score > best.score) best = { i, j, run, score }
    }
  }
  if (!best) return next.trim()
  return [...before.slice(0, best.i), ...after.slice(best.j)].join(" ")
}
