import type { UsageSummary, UsageTokens } from "@/features/second-brain/client"

export type UsageRange = "week" | "month" | "all"

export const USAGE_RANGES: ReadonlyArray<UsageRange> = ["week", "month", "all"]

const DAY = 24 * 60 * 60 * 1000

export function rangeSince(range: UsageRange, now: number) {
  if (range === "all") return 0
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start.getTime() - (range === "week" ? 6 : 29) * DAY
}

export const tokenKinds = ["input", "output", "reasoning", "cacheWrite", "cacheRead"] as const
export type TokenKind = (typeof tokenKinds)[number]

export function totalTokens(tokens: UsageTokens) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

export function composition(tokens: UsageTokens) {
  const total = totalTokens(tokens)
  return tokenKinds.map((kind) => ({ kind, value: tokens[kind], share: total > 0 ? tokens[kind] / total : 0 }))
}

export function formatTokens(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value)
}

export function formatCost(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 1 ? 3 : 2,
  }).format(value)
}

export function localDay(at: number) {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export function dayDate(day: string) {
  const [year, month, date] = day.split("-").map(Number)
  return new Date(year, month - 1, date)
}

export type DayBar = { day: string; fresh: number; cached: number; total: number }

export function fillDays(days: UsageSummary["days"], since: number, now: number): DayBar[] {
  const known = new Map(days.map((item) => [item.day, item]))
  const first = since > 0 ? since : days[0] ? dayDate(days[0].day).getTime() : now
  const out: DayBar[] = []
  const cursor = new Date(first)
  cursor.setHours(12, 0, 0, 0)
  const last = localDay(now)
  for (let guard = 0; guard < 2000; guard++) {
    const key = localDay(cursor.getTime())
    const item = known.get(key)
    out.push({
      day: key,
      fresh: item?.fresh ?? 0,
      cached: item?.cached ?? 0,
      total: (item?.fresh ?? 0) + (item?.cached ?? 0),
    })
    if (key >= last) break
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export function bucketDays(bars: ReadonlyArray<DayBar>, limit: number): DayBar[] {
  if (bars.length <= limit) return [...bars]
  const size = Math.ceil(bars.length / limit)
  const out: DayBar[] = []
  for (let index = 0; index < bars.length; index += size) {
    const group = bars.slice(index, index + size)
    out.push({
      day: group[0].day,
      fresh: group.reduce((sum, bar) => sum + bar.fresh, 0),
      cached: group.reduce((sum, bar) => sum + bar.cached, 0),
      total: group.reduce((sum, bar) => sum + bar.total, 0),
    })
  }
  return out
}

export function folderName(directory: string) {
  return (
    directory
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? directory
  )
}
