import { useFindTarget } from "./find-bar"
import { clearPaint, domRanges, paintRanges, revealRange } from "./dom-find"
import {
  threadFindMatches,
  threadFindTurns,
  type ThreadFindMatch,
  type ThreadFindMessage,
  type ThreadFindPart,
} from "./thread-find"

const MAX_FRAMES = 12

export function useThreadFindTarget(input: {
  root: () => HTMLElement | undefined
  messages: () => ReadonlyArray<ThreadFindMessage>
  parts: () => Readonly<Record<string, ReadonlyArray<ThreadFindPart> | undefined>>
  reveal: (turnID: string) => void
  more: () => boolean
  loadOlder: () => void
}) {
  let matches: ThreadFindMatch[] = []
  let query = ""
  let request = 0

  const turnRanges = (turnID: string) => {
    const root = input.root()
    if (!root) return []
    const rows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")].filter((row) =>
      (row.dataset.timelineKey ?? "").split(":").includes(turnID),
    )
    return rows.flatMap((row) => domRanges(row, query))
  }

  const show = (match: ThreadFindMatch, ticket: number, frame = 0) => {
    if (ticket !== request) return
    const ranges = turnRanges(match.turnID)
    if (ranges.length === 0 && frame < MAX_FRAMES) {
      requestAnimationFrame(() => show(match, ticket, frame + 1))
      return
    }
    const current = Math.min(match.occurrence, ranges.length - 1)
    paintRanges(ranges, current)
    revealRange(ranges[current])
  }

  useFindTarget({
    id: "thread",
    layer: 0,
    root: input.root,
    revision: () => input.messages().length,
    search: (next) => {
      query = next
      matches = threadFindMatches(threadFindTurns(input.messages(), input.parts()), next)
      if (next.trim() && input.more()) input.loadOlder()
      return matches.length
    },
    select: (index) => {
      const match = matches[index]
      if (!match) return
      request += 1
      const ticket = request
      input.reveal(match.turnID)
      requestAnimationFrame(() => show(match, ticket))
    },
    clear: () => {
      request += 1
      matches = []
      clearPaint()
    },
  })
}
