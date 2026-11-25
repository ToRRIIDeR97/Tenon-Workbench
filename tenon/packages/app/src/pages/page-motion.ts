import { NEW_THREAD_PATH } from "@/context/drafts"

const pages = new Set(["/", "/calendar", "/projects", "/projects/overview", "/command", "/routines"])

export function routeSection(pathname: string) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (path === NEW_THREAD_PATH || path === "/new-session" || path.startsWith("/server/")) return "thread"
  if (path.split("/")[2] === "session") return "thread"
  return pages.has(path) ? path : "/"
}

export type PageMotionKey = { section: string; count: number }

export function nextPageMotionKey(previous: PageMotionKey, pathname: string): PageMotionKey {
  const section = routeSection(pathname)
  if (section === previous.section) return previous
  return { section, count: section === "thread" ? previous.count : previous.count + 1 }
}
