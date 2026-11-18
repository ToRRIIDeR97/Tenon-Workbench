import type { BrowserFailure } from "@/context/platform"

export type BrowserStage = "empty" | "loading" | "error" | "page"

/**
 * What the Browser tab's stage shows (#325). The page is a native view laid over the stage and paints white until
 * a page commits, so it is shown only for `page`; the other stages are the tab's own DOM states.
 */
export function browserStage(page: {
  url: string
  loading: boolean
  error?: BrowserFailure
  committed?: boolean
}): BrowserStage {
  if (page.error) return "error"
  // The pending address of a first load isn't a page yet: only a committed navigation shows the native view.
  const committed = page.committed !== false && !!page.url && page.url !== "about:blank"
  if (committed) return "page"
  return page.loading ? "loading" : "empty"
}
