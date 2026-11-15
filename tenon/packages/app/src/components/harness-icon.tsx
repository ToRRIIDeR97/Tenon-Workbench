import { Match, Switch } from "solid-js"
import { Mark } from "@tenon/ui/logo"
import { ProviderIcon } from "@tenon/ui/provider-icon"
import { harnessLogo } from "./harness-logo"

/** A harness's logo at icon size (16px unless `class` sets a size): the Tenon mark, its maker's logo, or its letter. */
export function HarnessIcon(props: { instance?: { id: string; name: string }; class?: string }) {
  const logo = () => (props.instance ? harnessLogo(props.instance) : undefined)
  const provider = () => {
    const current = logo()
    return current?.kind === "provider" ? current.id : undefined
  }
  const letter = () => {
    const current = logo()
    return current?.kind === "letter" ? current.letter : undefined
  }
  const size = () => props.class ?? "size-4"
  return (
    <Switch>
      <Match when={logo()?.kind === "tenon"}>
        <Mark class={`${size()} shrink-0`} />
      </Match>
      <Match when={provider()}>
        {(id) => <ProviderIcon id={id()} class={`${size()} shrink-0 text-v2-icon-icon-base`} aria-hidden="true" />}
      </Match>
      <Match when={letter()}>
        {(initial) => (
          <span
            aria-hidden="true"
            class={`${size()} flex shrink-0 items-center justify-center rounded-[5px] bg-v2-background-bg-layer-02 text-[10px] leading-none text-v2-text-text-muted [font-weight:600]`}
          >
            {initial()}
          </span>
        )}
      </Match>
    </Switch>
  )
}
