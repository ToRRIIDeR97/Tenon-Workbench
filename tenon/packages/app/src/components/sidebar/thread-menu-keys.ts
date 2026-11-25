export type ThreadMenuAction = "rename" | "pin" | "fork" | "export" | "archive" | "delete"

export const THREAD_MENU_KEYS = { rename: "r", pin: "p", fork: "f", archive: "a", delete: "delete" } as const

const ACTION_BY_KEY: Partial<Record<string, ThreadMenuAction>> = {
  r: "rename",
  p: "pin",
  f: "fork",
  a: "archive",
  delete: "delete",
  backspace: "delete",
}

export function threadMenuAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "isComposing">,
) {
  const ignored = event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing
  return ignored ? undefined : ACTION_BY_KEY[event.key.toLowerCase()]
}
