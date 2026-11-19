import { Show, createEffect, onCleanup, onMount, type JSX } from "solid-js"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { sectionAttention, setSectionAttention, type PanelSection } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"

/** The rail's width. It joins the side panel in one shell, and stands alone 8px from the thread. */
export const SESSION_SIDE_RAIL_WIDTH = 48

export const sideRailReviewTabID = "session-side-panel-review-tab"

const badgeClass =
  "pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] leading-4 [font-weight:600] tabular-nums"

/**
 * The side panel's section switcher, shown whether the panel is open or closed. A section's button opens the
 * panel on it; the open section's button closes the panel. While the panel is closed, dragging the rail to the
 * left pulls it out (`onDragOut`). At its foot, outside the sections (it toggles the panel below the thread, not a
 * section), the Terminal button does what the header's terminal button and its shortcut do.
 */
export function SessionSideRail(props: {
  /** The section the open panel shows; undefined while the panel is closed. */
  section: PanelSection | undefined
  canReview: boolean
  reviewCount: number
  hasReview: boolean
  /** Subagents running in this thread. */
  running: number
  /** The side panel sits beside the rail in the same shell. */
  joined?: boolean
  onSelect: (section: PanelSection) => void
  onDragOut?: (event: PointerEvent) => void
}) {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const { sessionKey, view } = useSessionLayout()

  // An agent using the browser or a device marks that section instead of taking the panel away from the user.
  onMount(() => {
    const offBrowser = platform.browser?.onAgent(() => {
      if (props.section !== "browser") setSectionAttention(sessionKey(), "browser", true)
    })
    const offDevice = platform.device?.onAgent(() => {
      if (props.section !== "device") setSectionAttention(sessionKey(), "device", true)
    })
    onCleanup(() => {
      offBrowser?.()
      offDevice?.()
    })
  })
  createEffect(() => {
    if (props.section && sectionAttention(sessionKey(), props.section))
      setSectionAttention(sessionKey(), props.section, false)
  })

  const item = (input: {
    section: PanelSection
    label: string
    icon: JSX.Element
    badge?: JSX.Element
    id?: string
    controls?: string
    tooltip?: JSX.Element
    /** The icon brings its own tooltip (the context ring's usage). */
    plain?: boolean
  }) => {
    const button = () => (
      <div class="relative">
        <IconButtonV2
          type="button"
          role="tab"
          variant="ghost-muted"
          size="large"
          id={input.id}
          data-section={input.section}
          icon={input.icon}
          aria-label={input.label}
          aria-selected={props.section === input.section}
          aria-controls={input.controls ?? "review-panel"}
          // A 36px box with 10px corners; the unlayered icon-button rules need the overrides.
          class="!size-9 !rounded-[10px]"
          classList={{
            "!bg-v2-background-bg-accent-container !text-v2-text-text-on-accent-container":
              props.section === input.section,
          }}
          onPointerDown={(event: PointerEvent) => event.stopPropagation()}
          onClick={() => props.onSelect(input.section)}
        />
        {input.badge}
      </div>
    )
    if (input.plain) return button()
    return (
      <TooltipV2 placement="left" value={input.tooltip ?? input.label}>
        {button()}
      </TooltipV2>
    )
  }

  const attentionDot = (section: PanelSection) => (
    <Show when={sectionAttention(sessionKey(), section)}>
      <span
        data-slot="side-rail-attention"
        class="pointer-events-none absolute right-0 top-0 size-2 rounded-full bg-v2-icon-icon-accent"
      />
    </Show>
  )

  return (
    <div
      data-component="session-side-rail"
      // A tinted strip in the right shell, mirroring the navigation rail: the shell's outer corners on its own,
      // its right corners and a hairline to its left beside the side panel. The shell draws the ring.
      class="relative flex h-full w-12 shrink-0 flex-col items-center bg-v2-background-bg-layer-01 py-2"
      classList={{
        "cursor-col-resize": !!props.onDragOut,
        "rounded-[16px]": !props.joined,
        "rounded-r-[16px] shadow-[inset_1px_0_0_var(--v2-border-border-muted)]": !!props.joined,
      }}
      onPointerDown={(event) => {
        if (!props.onDragOut) return
        // No text selection or native drag may start from the rail: either takes the pointer away from the drag.
        event.preventDefault()
        props.onDragOut(event)
      }}
    >
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={language.t("session.panel.reviewAndFiles")}
        class="flex flex-col items-center gap-1.5"
      >
        <Show when={props.canReview}>
          {item({
            section: "changes",
            id: sideRailReviewTabID,
            controls: "session-side-panel-review-tabpanel",
            label: props.hasReview
              ? language.t("session.review.filesChanged", { count: props.reviewCount })
              : language.t("secondBrain.environment.changes"),
            tooltip: (
              <>
                {language.t("secondBrain.environment.changes")}
                <Show when={command.keybindParts("review.toggle").length > 0}>
                  <KeybindV2 keys={command.keybindParts("review.toggle")} variant="neutral" />
                </Show>
              </>
            ),
            icon: <Icon name="review" />,
            badge: (
              <Show when={props.hasReview}>
                <span class={`${badgeClass} bg-v2-icon-icon-accent text-v2-background-bg-base`}>
                  {props.reviewCount}
                </span>
              </Show>
            ),
          })}
        </Show>
        {item({
          section: "files",
          label: language.t("secondBrain.sidebar.files"),
          icon: <Icon name="filetree" />,
        })}
        {item({
          section: "documents",
          label: language.t("secondBrain.documents.title"),
          icon: <Icon name="document" />,
        })}
        {item({
          section: "agents",
          label: language.t("secondBrain.agents.title"),
          icon: <Icon name="activity" />,
          badge: (
            <Show when={props.running > 0}>
              <span
                aria-label={language.t("secondBrain.agents.runningBadge", { count: props.running })}
                class={`${badgeClass} bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container`}
              >
                {props.running.toLocaleString(language.intl())}
              </span>
            </Show>
          ),
        })}
        <Show when={platform.browser}>
          {item({
            section: "browser",
            label: language.t("secondBrain.browser.title"),
            icon: <Icon name="link" />,
            badge: attentionDot("browser"),
          })}
        </Show>
        <Show when={platform.device}>
          {item({
            section: "device",
            label: language.t("secondBrain.device.title"),
            icon: <Icon name="monitor" />,
            badge: attentionDot("device"),
          })}
        </Show>
        {/* Always on the rail, so the canvas is one click away before the agent draws; it opens on its empty state. */}
        {item({
          section: "canvas",
          label: language.t("secondBrain.canvas.title"),
          icon: <Icon name="photo" />,
        })}
        {item({
          section: "details",
          label: language.t("secondBrain.sessionTab.title"),
          icon: <SessionContextUsage variant="indicator" placement="left" />,
          plain: true,
        })}
      </div>
      <TooltipV2
        class="mt-auto"
        placement="left"
        value={
          <>
            {language.t("command.terminal.toggle")}
            <Show when={command.keybindParts("terminal.toggle").length > 0}>
              <KeybindV2 keys={command.keybindParts("terminal.toggle")} variant="neutral" />
            </Show>
          </>
        }
      >
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          data-action="side-rail-terminal"
          icon={<Icon name="terminal" />}
          aria-label={language.t("command.terminal.toggle")}
          aria-expanded={view().terminal.opened()}
          aria-controls="terminal-panel"
          class="!size-9 !rounded-[10px]"
          classList={{
            "!bg-v2-background-bg-accent-container !text-v2-text-text-on-accent-container": view().terminal.opened(),
          }}
          onPointerDown={(event: PointerEvent) => event.stopPropagation()}
          onClick={() => command.trigger("terminal.toggle")}
        />
      </TooltipV2>
    </div>
  )
}
