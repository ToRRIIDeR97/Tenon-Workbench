const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

interface Info {
  readonly title?: string
  readonly parentID?: string
  readonly time: {
    readonly created: number
  }
}

export function withTimestampedFallback(info: Info) {
  return info.title ?? `${info.parentID ? "Child" : "New"} session - ${new Date(info.time.created).toISOString()}`
}

export function sessionTitle(title?: string) {
  if (!title) return title
  const match = title.match(pattern)
  if (!match) return title
  return match[1] === "Child session" ? "Child thread" : "New thread"
}
