import { createStore } from "solid-js/store"
import { QueuedActionsUnsupportedError } from "@/utils/server-compat"

export function createQueuedActions(input: {
  remove: (messageID: string) => Promise<void>
  send: (messageID: string) => Promise<void>
  onError: (error: unknown) => void
  onUnsupported: () => void
}) {
  const [state, setState] = createStore({ pending: undefined as string | undefined, unsupported: false })
  const run = (action: (messageID: string) => Promise<void>, messageID: string) => {
    if (state.pending || state.unsupported) return Promise.resolve()
    setState("pending", messageID)
    return action(messageID)
      .catch((error: unknown) => {
        if (!(error instanceof QueuedActionsUnsupportedError)) return input.onError(error)
        setState("unsupported", true)
        input.onUnsupported()
      })
      .finally(() => setState("pending", undefined))
  }
  return {
    state,
    remove: (messageID: string) => run(input.remove, messageID),
    send: (messageID: string) => run(input.send, messageID),
  }
}
