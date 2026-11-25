export type Hunk = { start: number; removed: string[]; added: string[] }

const DIFF_LIMIT = 4_000_000

const lines = (text: string) => text.split("\n")

export function trackedHunks(before: string, after: string): Hunk[] {
  if (before === after) return []
  const left = lines(before)
  const right = lines(after)
  const head = { count: 0 }
  while (head.count < left.length && head.count < right.length && left[head.count] === right[head.count])
    head.count += 1
  const tail = { count: 0 }
  while (
    tail.count < left.length - head.count &&
    tail.count < right.length - head.count &&
    left[left.length - 1 - tail.count] === right[right.length - 1 - tail.count]
  )
    tail.count += 1
  const a = left.slice(head.count, left.length - tail.count)
  const b = right.slice(head.count, right.length - tail.count)
  if (a.length * b.length > DIFF_LIMIT) return [{ start: head.count, removed: a, added: b }]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
  const hunks: Hunk[] = []
  const walk = { i: 0, j: 0, open: undefined as Hunk | undefined }
  const current = () => {
    if (!walk.open) {
      walk.open = { start: head.count + walk.j, removed: [], added: [] }
      hunks.push(walk.open)
    }
    return walk.open
  }
  while (walk.i < a.length || walk.j < b.length) {
    if (walk.i < a.length && walk.j < b.length && a[walk.i] === b[walk.j]) {
      walk.open = undefined
      walk.i += 1
      walk.j += 1
      continue
    }
    if (walk.j >= b.length || (walk.i < a.length && lengths[walk.i + 1][walk.j] >= lengths[walk.i][walk.j + 1])) {
      current().removed.push(a[walk.i])
      walk.i += 1
      continue
    }
    current().added.push(b[walk.j])
    walk.j += 1
  }
  return hunks
}

export function hunkKeys(hunks: readonly Hunk[]) {
  const shift = { lines: 0 }
  return hunks.map((hunk) => {
    const start = hunk.start - shift.lines
    shift.lines += hunk.added.length - hunk.removed.length
    return `${start}\u0000${hunk.removed.join("\n")}\u0000${hunk.added.join("\n")}`
  })
}

export function revertHunk(after: string, hunk: Hunk) {
  const next = lines(after)
  next.splice(hunk.start, hunk.added.length, ...hunk.removed)
  return next.join("\n")
}

export async function contentHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export type TrackedRow =
  | { kind: "same"; text: string; line: number }
  | { kind: "added"; text: string; line: number; hunk: number }
  | { kind: "removed"; text: string; hunk: number }
  | { kind: "review"; hunk: number }

export function trackedRows(
  after: string,
  hunks: readonly Hunk[],
  skip: ReadonlySet<number> = new Set(),
): TrackedRow[] {
  const text = lines(after)
  const rows: TrackedRow[] = []
  const state = { line: 0 }
  const plain = (until: number) => {
    while (state.line < until && state.line < text.length) {
      rows.push({ kind: "same", text: text[state.line], line: state.line + 1 })
      state.line += 1
    }
  }
  hunks.forEach((hunk, index) => {
    plain(hunk.start)
    if (skip.has(index)) return
    hunk.removed.forEach((line) => rows.push({ kind: "removed", text: line, hunk: index }))
    hunk.added.forEach((line) => {
      rows.push({ kind: "added", text: line, line: state.line + 1, hunk: index })
      state.line += 1
    })
    rows.push({ kind: "review", hunk: index })
  })
  plain(text.length)
  return rows
}
