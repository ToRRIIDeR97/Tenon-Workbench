export function sameLocalDay(a: number | Date, b: number | Date) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function previousLocalDay(value: number | Date) {
  const date = new Date(value)
  date.setDate(date.getDate() - 1)
  return date
}

const DAY = 86_400_000
const relativeUnits: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["day", DAY],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
]

export function formatRelativeTime(value: number, now: number, locale: string) {
  const diff = value - now
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
  for (const [unit, size] of relativeUnits) {
    const amount = Math.trunc(diff / size)
    if (amount !== 0) return format.format(amount, unit)
  }
  return format.format(0, "second")
}

export function formatDateTimeMedium(value: number | string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date)
}

export function parseISODate(iso: string | undefined) {
  if (!iso) return Number.NaN
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso).getTime()
}

export function withinMonths(iso: string | undefined, months: number, now: number) {
  const time = parseISODate(iso)
  if (Number.isNaN(time)) return false
  return Math.abs(time - now) < months * 30 * DAY
}
