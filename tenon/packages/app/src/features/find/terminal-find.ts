import { findRanges } from "./find-text"

export type TerminalMatch = { row: number; column: number; length: number }

export function terminalMatches(lines: ReadonlyArray<string>, query: string): TerminalMatch[] {
  return lines.flatMap((line, row) =>
    findRanges(line, query).map((range) => ({ row, column: range.start, length: range.end - range.start })),
  )
}
