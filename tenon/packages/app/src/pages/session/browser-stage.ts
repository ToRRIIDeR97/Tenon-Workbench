import type { BrowserFailure } from "@/context/platform"

export type BrowserStage = "empty" | "loading" | "error" | "page"

export function browserStage(page: {
  url: string
  loading: boolean
  error?: BrowserFailure
  committed?: boolean
}): BrowserStage {
  if (page.error) return "error"
  const committed = page.committed !== false && !!page.url && page.url !== "about:blank"
  if (committed) return "page"
  return page.loading ? "loading" : "empty"
}
