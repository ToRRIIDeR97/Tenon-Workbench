// Small date helpers on Intl and Date, so the app shell does not ship a date library.

/** Whether two timestamps fall on the same local calendar day. */
export function sameLocalDay(a: number | Date, b: number | Date) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** The same local time one day earlier. */
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

/** "3 days ago" / "in 2 hours", in the largest whole unit. */
export function formatRelativeTime(value: number, now: number, locale: string) {
  const diff = value - now
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
  for (const [unit, size] of relativeUnits) {
    const amount = Math.trunc(diff / size)
    if (amount !== 0) return format.format(amount, unit)
  }
  return format.format(0, "second")
}

/** Medium date and time, such as "Aug 31, 2026, 4:18 PM". Returns undefined for an unparseable value. */
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

/** Milliseconds for an ISO date or date-time, or NaN. Date-only strings are read as local midnight. */
export function parseISODate(iso: string | undefined) {
  if (!iso) return Number.NaN
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso).getTime()
}

/** Whether an ISO date (such as a model release date) is within `months` 30-day months of `now`. */
export function withinMonths(iso: string | undefined, months: number, now: number) {
  const time = parseISODate(iso)
  if (Number.isNaN(time)) return false
  return Math.abs(time - now) < months * 30 * DAY
}
