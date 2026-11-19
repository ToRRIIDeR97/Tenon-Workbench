// The engine's live transcript covers only the last 28 s of the recording, so each `partial` can start later in the
// speech than the caption already shown. Merging lines the partial up with the caption and keeps the words that
// have left the engine's window in front of it, so the caption only grows (#328).

/** Words at the start of a partial that may be a cut-off fragment of a word the window sliced through. */
const MAX_SKIPPED = 3
/** Consecutive words that must agree before a later position in the caption counts as the same speech. */
const MIN_RUN = 3

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")

/** The caption to show after `next`: `previous`'s words that `next` no longer covers, then `next`. */
export function mergeCaption(previous: string, next: string) {
  const before = previous.split(/\s+/).filter(Boolean)
  const after = next.split(/\s+/).filter(Boolean)
  if (before.length === 0 || after.length === 0) return next.trim()
  const a = before.map(norm)
  const b = after.map(norm)
  // The alignment with the longest run of agreeing words wins; a real overlap is most of the window, a chance one
  // a few common words.
  let best: { i: number; j: number; run: number; score: number } | undefined
  for (let j = 0; j <= Math.min(MAX_SKIPPED, b.length - 1); j++) {
    for (let i = 0; i < a.length; i++) {
      if (!a[i] || a[i] !== b[j]) continue
      let run = 0
      while (i + run < a.length && j + run < b.length && a[i + run] === b[j + run]) run++
      // At the caption's start a short caption may simply be growing; later in it, a run must be long enough.
      const needed = i === 0 ? Math.min(MIN_RUN, a.length, b.length - j) : Math.min(MIN_RUN, b.length - j)
      if (run < needed) continue
      // The window that slid past the caption's start overlaps the caption up to its end; a phrase repeated earlier
      // doesn't, so a run that reaches the end wins over a longer one that stops short.
      const score = run + (i + run === a.length ? a.length : 0)
      if (!best || score > best.score) best = { i, j, run, score }
    }
  }
  // Nothing lines up: the model rewrote what it heard, and its newest reading wins.
  if (!best) return next.trim()
  return [...before.slice(0, best.i), ...after.slice(best.j)].join(" ")
}
