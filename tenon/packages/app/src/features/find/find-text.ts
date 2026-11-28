export type FindRange = { start: number; end: number }

export type FindOptions = { caseSensitive?: boolean }

export function findRanges(text: string, query: string, options: FindOptions = {}): FindRange[] {
  if (!query.trim() || !text) return []
  const haystack = options.caseSensitive ? text : text.toLowerCase()
  const needle = options.caseSensitive ? query : query.toLowerCase()
  const ranges: FindRange[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from)
    if (start < 0) break
    ranges.push({ start, end: start + needle.length })
    from = start + needle.length
  }
  return ranges
}

export function countMatches(text: string, query: string, options: FindOptions = {}) {
  return findRanges(text, query, options).length
}

export function stepIndex(count: number, current: number, direction: 1 | -1) {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}
