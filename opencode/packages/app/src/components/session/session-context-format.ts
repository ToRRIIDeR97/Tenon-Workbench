import { formatDateTimeMedium } from "@/utils/date"

export function createSessionContextFormatter(locale: string) {
  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale) + "%"
    },
    time(value: number | string | undefined) {
      if (!value) return "—"
      return formatDateTimeMedium(value, locale) ?? "—"
    },
  }
}
