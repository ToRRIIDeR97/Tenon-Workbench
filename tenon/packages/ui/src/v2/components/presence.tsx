import createPresence from "solid-presence"
import { type ParentProps, Show, createSignal } from "solid-js"

export interface PresenceProps extends ParentProps {
  when: boolean
  enterClass?: string
  exitClass?: string
  class?: string
}

export function Presence(props: PresenceProps) {
  const [ref, setRef] = createSignal<HTMLDivElement | null>(null)
  const presence = createPresence({ show: () => props.when, element: ref })

  return (
    <Show when={presence.present()}>
      <div
        ref={setRef}
        data-component="presence-v2"
        class={[props.class, props.when ? (props.enterClass ?? "animate-enter") : (props.exitClass ?? "animate-exit")]
          .filter(Boolean)
          .join(" ")}
      >
        {props.children}
      </div>
    </Show>
  )
}
