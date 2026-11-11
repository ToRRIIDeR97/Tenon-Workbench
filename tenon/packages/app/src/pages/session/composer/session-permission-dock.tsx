import { For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"
import { permissionSummary } from "./permission-summary"

/**
 * One approval: what will happen in one line, the exact commands or paths folded under it, then Deny and
 * Allow once. Allow once has a menu for "always" and for letting the whole thread run. A request that reaches
 * outside the folder keeps the warning tone and offers no "always".
 */
export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  /** Allows this request and switches the thread to Full auto. Left out where there is no thread. */
  onAllowThread?: () => void
}) {
  const language = useLanguage()
  const summary = () => permissionSummary(props.request)

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <section
      data-component="dock-prompt"
      data-kind="permission"
      data-risky={summary().risky ? "" : undefined}
      aria-labelledby="permission-dock-title"
      class="mb-2 flex flex-col gap-3 rounded-[24px] px-5 pt-4 pb-3.5"
      classList={{
        "bg-v2-state-bg-warning": summary().risky,
        "bg-v2-background-bg-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]": !summary().risky,
      }}
    >
      <div class="flex flex-col gap-1">
        <h2
          id="permission-dock-title"
          class="text-[14px] leading-5 [font-weight:560]"
          classList={{ "text-v2-state-fg-warning": summary().risky, "text-v2-text-text-base": !summary().risky }}
        >
          {language.plural(summary().key, summary().count, { count: summary().count, tool: summary().tool })}
        </h2>
        <Show when={toolDescription()}>
          <p class="text-[13px] leading-5 text-v2-text-text-muted">{toolDescription()}</p>
        </Show>
      </div>

      <Show when={props.request.patterns.length > 0}>
        <details
          open={props.request.patterns.length <= 2}
          class="rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2"
        >
          <summary class="cursor-pointer text-[12px] leading-5 text-v2-text-text-muted">
            {language.plural("secondBrain.permission.details", props.request.patterns.length, {
              count: props.request.patterns.length,
            })}
          </summary>
          <div class="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
            <For each={props.request.patterns}>
              {(pattern) => (
                <code class="font-mono text-[12px] leading-5 text-v2-text-text-base break-all">{pattern}</code>
              )}
            </For>
          </div>
        </details>
      </Show>

      <div data-slot="permission-footer-actions" class="flex items-center justify-end gap-2">
        <ButtonV2 variant="outline" onClick={() => props.onDecide("reject")} disabled={props.responding}>
          {language.t("ui.permission.deny")}
        </ButtonV2>
        <div class="flex items-center gap-px">
          <ButtonV2
            variant="contrast"
            class="rounded-r-[4px]"
            onClick={() => props.onDecide("once")}
            disabled={props.responding}
          >
            {language.t("ui.permission.allowOnce")}
          </ButtonV2>
          <Show when={!summary().risky}>
            <MenuV2 gutter={4} placement="top-end">
              <MenuV2.Trigger
                as={ButtonV2}
                variant="contrast"
                class="rounded-l-[4px] px-2.5"
                disabled={props.responding}
                aria-label={language.t("secondBrain.permission.more")}
              >
                <Icon name="chevron-down" size="small" />
              </MenuV2.Trigger>
              <MenuV2.Portal>
                <MenuV2.Content>
                  <MenuV2.Item onSelect={() => props.onDecide("always")}>
                    {language.t("secondBrain.permission.always")}
                  </MenuV2.Item>
                  <Show when={props.onAllowThread}>
                    {(allow) => (
                      <MenuV2.Item onSelect={() => allow()()}>
                        {language.t("secondBrain.permission.thread")}
                      </MenuV2.Item>
                    )}
                  </Show>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
          </Show>
        </div>
      </div>
    </section>
  )
}
