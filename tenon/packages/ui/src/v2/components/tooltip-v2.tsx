import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { createEffect, Match, onCleanup, splitProps, Switch, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { tooltipOpenDelay } from "./tooltip-delay"
import "./tooltip-v2.css"

// Shared by every TooltipV2 so moving between triggers right after one closes skips the delay.
let lastClosedAt: number | undefined

export interface TooltipV2Props extends Omit<ComponentProps<typeof KobalteTooltip>, "openDelay" | "skipDelayDuration"> {
  value: JSX.Element
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
}

export function TooltipV2(props: TooltipV2Props) {
  let ref: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
  })
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "ignoreSafeArea",
    "value",
  ])

  const setOpen = (open: boolean) => {
    if (!open && state.open) lastClosedAt = Date.now()
    setState("open", open)
  }

  const close = () => setOpen(false)

  const inside = () => {
    const active = document.activeElement
    if (!ref || !active) return false
    return ref.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand) return
    if (ref?.matches(":hover")) return
    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!ref?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)
    if (expand) {
      setState("block", true)
      close()
      return
    }
    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const leave = () => {
    close()
    drop()
  }

  createEffect(() => {
    if (!ref) return
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => obs.disconnect())
  })

  let justClickedTrigger = false

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <KobalteTooltip
          gutter={4}
          {...others}
          // Read when the pointer enters, so the skip window is checked at that moment.
          openDelay={tooltipOpenDelay(lastClosedAt, Date.now())}
          skipDelayDuration={0}
          closeDelay={0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={local.forceOpen || state.open}
          onOpenChange={(open) => {
            if (local.forceOpen) return
            if (state.block && open) return
            // A press on the trigger only suppresses the reopen that follows it; a close request always goes through.
            if (justClickedTrigger) {
              justClickedTrigger = false
              if (open) return
            }
            setOpen(open)
          }}
        >
          <KobalteTooltip.Trigger
            ref={ref}
            as="div"
            data-component="tooltip-v2-trigger"
            class={local.class}
            onPointerDownCapture={arm}
            onKeyDownCapture={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return
              arm()
            }}
            onPointerLeave={leave}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Escape") close()
            }}
            onFocusOut={() => requestAnimationFrame(() => drop())}
          >
            {local.children}
          </KobalteTooltip.Trigger>
          <KobalteTooltip.Portal>
            <KobalteTooltip.Content
              ref={(el) => {
                const theme = ref?.closest("[data-theme]")?.getAttribute("data-theme")
                if (theme) el.setAttribute("data-theme", theme)
              }}
              data-component="tooltip-v2"
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerDownOutside={(e) => {
                if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                  justClickedTrigger = true
                }
                e.preventDefault()
              }}
            >
              {local.value}
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}

export interface PathTooltipProps extends Omit<TooltipV2Props, "value"> {
  name: JSX.Element
  path: string
}

// Name on the first line, the full path below it in muted monospace.
export function PathTooltip(props: PathTooltipProps) {
  const [local, others] = splitProps(props, ["name", "path"])
  return (
    <TooltipV2
      {...others}
      value={
        <div data-slot="tooltip-v2-path">
          <span data-slot="tooltip-v2-path-name">{local.name}</span>
          <span data-slot="tooltip-v2-path-value">{local.path}</span>
        </div>
      }
    />
  )
}
