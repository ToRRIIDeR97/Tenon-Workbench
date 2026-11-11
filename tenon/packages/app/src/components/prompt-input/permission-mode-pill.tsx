import { For, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Popover } from "@tenon/ui/popover"
import { Icon } from "@tenon/ui/v2/icon"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import type { PermissionMode } from "@/context/permission-auto-respond"
import { useSDK } from "@/context/sdk"
import { Choice } from "./model-pill"

const MODE_ACTION = { "data-action": "permission-mode" }

const MODES = [
  { id: "ask", label: "secondBrain.permissionMode.ask", detail: "secondBrain.permissionMode.ask.detail" },
  { id: "edit", label: "secondBrain.permissionMode.edit", detail: "secondBrain.permissionMode.edit.detail" },
  { id: "full", label: "secondBrain.permissionMode.full", detail: "secondBrain.permissionMode.full.detail" },
] as const

/**
 * Ask, Auto-edit or Full auto for the open thread, or for its folder before the thread exists. Every harness
 * routes its approvals through Tenon, so one switch covers the built-in agent, Claude Code, Codex and ACP agents.
 */
export function PermissionModePill() {
  const language = useLanguage()
  const permission = usePermission()
  const sdk = useSDK()
  const params = useParams<{ id?: string }>()
  const [state, setState] = createStore({ open: false })
  const mode = createMemo(() => permission.mode(params.id, sdk().directory))
  const current = () => MODES.find((item) => item.id === mode()) ?? MODES[0]
  const pick = (next: PermissionMode) => {
    permission.setMode(params.id, sdk().directory, next)
    setState("open", false)
  }

  return (
    <TooltipV2 placement="top" value={language.t("secondBrain.permissionMode.title")}>
      <Popover
        open={state.open}
        onOpenChange={(open) => setState("open", open)}
        placement="top-start"
        gutter={6}
        class="w-[300px] [&_[data-slot=popover-body]]:p-1.5"
        triggerAs="button"
        triggerProps={{
          type: "button",
          ...MODE_ACTION,
          "aria-label": language.t("secondBrain.permissionMode.title"),
          class:
            "flex h-8 items-center gap-1.5 rounded-full px-3 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[expanded]:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none",
        }}
        trigger={
          <>
            <span>{language.t(current().label)}</span>
            <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          </>
        }
      >
        <div role="menu" class="flex flex-col gap-px text-[13px]">
          <For each={MODES}>
            {(item) => (
              <Choice
                label={language.t(item.label)}
                detail={language.t(item.detail)}
                selected={item.id === mode()}
                onSelect={() => pick(item.id)}
              />
            )}
          </For>
        </div>
      </Popover>
    </TooltipV2>
  )
}
