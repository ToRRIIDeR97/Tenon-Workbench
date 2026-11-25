export const THREAD_REFERENCE_MIME = "application/x-tenon-thread"

export const threadReferenceURI = (sessionID: string, full = false) =>
  `tenon-thread://${encodeURIComponent(sessionID)}${full ? "?full=1" : ""}`

export const THREAD_DRAG_PREFIX = "thread:"
