import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"
import { JSX } from "solid-js"
import "./icon-button-v2.css"

export interface IconButtonV2Props
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList"> {
  icon?: JSX.Element
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "contrast" | "ghost" | "ghost-muted"
  state?: "rest" | "hover" | "pressed"
}

export function IconButtonV2(props: ComponentProps<"button"> & IconButtonV2Props) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList", "state"])
  return (
    <Kobalte
      {...rest}
      data-component="icon-button-v2"
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-state={split.state}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.icon}
    </Kobalte>
  )
}
