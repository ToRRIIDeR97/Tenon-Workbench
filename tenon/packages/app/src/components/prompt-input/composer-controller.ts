import { createStore } from "solid-js/store"

/**
 * The text and send state behind `ComposerBox`. Home, the Command Centre page and the command strip each
 * supply their own `send`; the trimming, guards, busy state and "keep the text on failure" rule live here once.
 */
export type ComposerController = {
  value: () => string
  setValue: (text: string) => void
  busy: () => boolean
  /** No typing or sending, e.g. without a workspace. */
  disabled: () => boolean
  canSend: () => boolean
  /** Resolves true when the page's send succeeded. */
  send: () => Promise<boolean>
}

export function createComposerController(input: {
  /** Receives the trimmed text; resolve false (or throw) to keep it in the box. */
  send: (text: string) => boolean | Promise<boolean>
  disabled?: () => boolean
  /** Typing is allowed but sending waits, e.g. while the harness list loads. */
  blocked?: () => boolean
  initial?: string
}): ComposerController {
  const [state, setState] = createStore({ value: input.initial ?? "", busy: false })
  const disabled = () => input.disabled?.() ?? false
  const canSend = () => !!state.value.trim() && !state.busy && !disabled() && !input.blocked?.()

  const send = async () => {
    if (!canSend()) return false
    const text = state.value.trim()
    setState("busy", true)
    // The page's send starts now; a synchronous throw becomes a rejection, which keeps the text.
    const sent = await new Promise<boolean>((resolve) => resolve(input.send(text))).catch(() => false)
    // Text typed while the send was in flight stays.
    if (sent) setState("value", (current) => (current.trim() === text ? "" : current))
    setState("busy", false)
    return sent
  }

  return {
    value: () => state.value,
    setValue: (text) => setState("value", text),
    busy: () => state.busy,
    disabled,
    canSend,
    send,
  }
}

/** Enter sends; Shift+Enter adds a line and IME composition keeps its own Enter. */
export function composerKeySends(event: { key: string; shiftKey: boolean; isComposing: boolean }) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing
}
