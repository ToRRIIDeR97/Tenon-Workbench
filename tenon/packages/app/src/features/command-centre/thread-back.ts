export type ThreadBack = { type: "history" } | { type: "href"; href: string }

export function commandBackState(href: string) {
  return { commandBack: href }
}

export function threadBack(input: { state: unknown; commandThread: boolean }): ThreadBack | undefined {
  const state = input.state
  const from =
    typeof state === "object" && state !== null && "commandBack" in state
      ? (state as { commandBack: unknown }).commandBack
      : undefined
  if (typeof from === "string" && from.length > 0) return { type: "history" }
  if (input.commandThread) return { type: "href", href: "/command" }
  return undefined
}
