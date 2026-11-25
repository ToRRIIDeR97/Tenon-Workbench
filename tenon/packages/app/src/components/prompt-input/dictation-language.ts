export const DICTATION_LANGUAGES = [
  "en",
  "zh",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "ru",
  "uk",
  "pl",
  "tr",
  "ar",
  "hi",
  "ja",
  "ko",
  "vi",
  "th",
  "id",
  "ms",
] as const

export function dictationLanguage(setting: string | undefined, locale: string) {
  if (setting === "auto") return undefined
  const app = baseLanguage(locale)
  if (!setting) return app === "en" ? "en" : undefined
  if (setting === "app") return app
  return baseLanguage(setting)
}

function baseLanguage(code: string) {
  const base = code.split(/[-_]/)[0]?.toLowerCase()
  return base === "zht" ? "zh" : base || undefined
}
