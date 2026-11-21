/**
 * Back from a thread opened in the Command Centre. Its views open a thread with `commandBackState(<where it was>)`
 * in the history state, so Back steps back to that exact screen (the hub, a Project's crew, another thread). A
 * Command Centre thread reached any other way (the sidebar, a link, a restart) goes back to the hub.
 */
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
