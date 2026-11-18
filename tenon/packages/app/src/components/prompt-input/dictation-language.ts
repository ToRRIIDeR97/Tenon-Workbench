/**
 * The spoken languages Settings › Dictation offers, as ISO 639 codes. Whisper knows many more; these cover the app's
 * languages and the common ones. Names are shown with `Intl.DisplayNames`, so they need no strings of their own.
 */
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

/**
 * The language code dictation asks the engine for, or undefined to let the model detect it.
 *
 * - Unset (the default): English when the app is in English, otherwise detect. Detecting per recording is what made
 *   Whisper sometimes answer in another language for English speech, and an English app is the common case; for any
 *   other app language a fixed hint would turn speech in another language into a translation, so it detects.
 * - "app": the app's language, always.
 * - "auto": detect on every recording.
 * - A code: that language.
 */
export function dictationLanguage(setting: string | undefined, locale: string) {
  if (setting === "auto") return undefined
  const app = baseLanguage(locale)
  if (!setting) return app === "en" ? "en" : undefined
  if (setting === "app") return app
  return baseLanguage(setting)
}

function baseLanguage(code: string) {
  const base = code.split(/[-_]/)[0]?.toLowerCase()
  // The app names Traditional Chinese "zht"; speech models know one Chinese.
  return base === "zht" ? "zh" : base || undefined
}
