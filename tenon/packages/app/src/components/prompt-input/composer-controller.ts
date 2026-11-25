import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export type ComposerController = {
  value: () => string
  setValue: (text: string) => void
  busy: () => boolean
  disabled: () => boolean
  canSend: () => boolean
  send: () => Promise<boolean>
}

export function createComposerController(input: {
  send: (text: string) => boolean | Promise<boolean>
  disabled?: () => boolean
  blocked?: () => boolean
  initial?: string
  persist?: string
}): ComposerController {
  const initial = createStore({ value: input.initial ?? "" })
  const [text, setText] = input.persist ? persisted(Persist.window(`composer.${input.persist}`), initial) : initial
  const [state, setState] = createStore({ busy: false })
  const disabled = () => input.disabled?.() ?? false
  const canSend = () => !!text.value.trim() && !state.busy && !disabled() && !input.blocked?.()

  const send = async () => {
    if (!canSend()) return false
    const sending = text.value.trim()
    setState("busy", true)
    const sent = await new Promise<boolean>((resolve) => resolve(input.send(sending))).catch(() => false)
    if (sent) setText("value", (current) => (current.trim() === sending ? "" : current))
    setState("busy", false)
    return sent
  }

  return {
    value: () => text.value,
    setValue: (value) => setText("value", value),
    busy: () => state.busy,
    disabled,
    canSend,
    send,
  }
}

export function composerKeySends(event: { key: string; shiftKey: boolean; isComposing: boolean }) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing
}
