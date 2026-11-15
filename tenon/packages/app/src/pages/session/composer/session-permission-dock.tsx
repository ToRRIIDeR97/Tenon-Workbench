import { For, Show, createSignal } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"
import { permissionSummary } from "./permission-summary"

// Commands or paths shown before "Show N more".
const VISIBLE = 3

/**
 * One approval: what will happen in one line, the exact commands or paths under it, then Deny and Allow once.
 * Both buttons split: Allow once offers "always" and letting the whole thread run; Deny offers a reason for the
 * agent. A request that reaches outside the folder keeps the warning tone and offers no "always".
 */
export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject", message?: string) => void
  /** Allows this request and switches the thread to Full auto. Left out where there is no thread. */
  onAllowThread?: () => void
}) {
  const language = useLanguage()
  const summary = () => permissionSummary(props.request)
  const [state, setState] = createSignal({ all: false, reasoning: false, reason: "" })
  const patterns = () => (state().all ? props.request.patterns : props.request.patterns.slice(0, VISIBLE))
  const hidden = () => props.request.patterns.length - VISIBLE
  const closeReason = () => setState((value) => ({ ...value, reasoning: false, reason: "" }))

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
      <h2
        id="permission-dock-title"
        class="text-[14px] leading-5 [font-weight:560]"
        classList={{ "text-v2-state-fg-warning": summary().risky, "text-v2-text-text-base": !summary().risky }}
      >
        {language.plural(summary().key, summary().count, { count: summary().count, tool: summary().tool })}
      </h2>

      <Show when={props.request.patterns.length > 0}>
        <div class="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2">
          <For each={patterns()}>
            {(pattern) => (
              <code class="font-mono text-[12px] leading-5 text-v2-text-text-base break-all">{pattern}</code>
            )}
          </For>
          <Show when={!state().all && hidden() > 0}>
            <button
              type="button"
              class="self-start text-[12px] leading-5 text-v2-text-text-muted hover:text-v2-text-text-base"
              onClick={() => setState((value) => ({ ...value, all: true }))}
            >
              {language.t("secondBrain.permission.showMore", { count: hidden() })}
            </button>
          </Show>
        </div>
      </Show>

      <Show
        when={state().reasoning}
        fallback={
          <div data-slot="permission-footer-actions" class="flex items-center justify-end gap-2">
            <SplitButton
              label={language.t("ui.permission.deny")}
              variant="outline"
              disabled={props.responding}
              onClick={() => props.onDecide("reject")}
              menuLabel={language.t("secondBrain.permission.denyMore")}
              items={[
                {
                  label: language.t("secondBrain.permission.denyWithReason"),
                  onSelect: () => setState((value) => ({ ...value, reasoning: true })),
                },
              ]}
            />
            <SplitButton
              label={language.t("ui.permission.allowOnce")}
              variant="contrast"
              disabled={props.responding}
              onClick={() => props.onDecide("once")}
              menuLabel={language.t("secondBrain.permission.more")}
              items={
                summary().risky
                  ? []
                  : [
                      { label: language.t("secondBrain.permission.always"), onSelect: () => props.onDecide("always") },
                      ...(props.onAllowThread
                        ? [{ label: language.t("secondBrain.permission.thread"), onSelect: props.onAllowThread }]
                        : []),
                    ]
              }
            />
          </div>
        }
      >
        {/* Denying with a reason: the built-in agent reads it from the reply; other harnesses get it as a queued message. */}
        <form
          class="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            props.onDecide("reject", state().reason)
          }}
        >
          <input
            type="text"
            autofocus
            value={state().reason}
            placeholder={language.t("secondBrain.permission.reason")}
            aria-label={language.t("secondBrain.permission.reason")}
            class="h-7 min-w-0 flex-1 rounded-full bg-v2-background-bg-layer-01 px-3.5 text-[13px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-muted focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
            onInput={(event) => {
              const reason = event.currentTarget.value
              setState((value) => ({ ...value, reason }))
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.stopPropagation()
              closeReason()
            }}
          />
          <ButtonV2 type="button" variant="ghost" onClick={closeReason}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant="outline" disabled={props.responding}>
            {language.t("ui.permission.deny")}
          </ButtonV2>
        </form>
      </Show>
    </section>
  )
}

/**
 * One pill: the main action and a chevron half that opens a menu, clipped by one rounded wrapper with a hairline
 * between them. Each half draws its focus ring inside, since the wrapper clips. Just the pill when there is nothing
 * to offer.
 */
function SplitButton(props: {
  label: string
  variant: "outline" | "contrast"
  disabled: boolean
  onClick: () => void
  menuLabel: string
  items: { label: string; onSelect: () => void }[]
}) {
  const joined = () => props.items.length > 0
  return (
    <div
      class="flex items-center rounded-full overflow-hidden"
      classList={{ "shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]": props.variant === "outline" && joined() }}
    >
      <ButtonV2
        variant={props.variant}
        disabled={props.disabled}
        class="focus-visible:!outline-offset-[-2px]"
        classList={{ "!rounded-none !shadow-none": joined() }}
        onClick={props.onClick}
      >
        {props.label}
      </ButtonV2>
      <Show when={joined()}>
        <MenuV2 gutter={4} placement="top-end">
          <MenuV2.Trigger
            as="button"
            type="button"
            data-component="button-v2"
            data-size="normal"
            data-variant={props.variant}
            disabled={props.disabled}
            aria-label={props.menuLabel}
            class="relative !rounded-none !shadow-none focus-visible:!outline-offset-[-2px] before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-current before:opacity-25"
            style={{ "padding-inline": "8px" }}
          >
            <Icon name="chevron-down" size="small" />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content>
              <For each={props.items}>{(item) => <MenuV2.Item onSelect={item.onSelect}>{item.label}</MenuV2.Item>}</For>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </Show>
    </div>
  )
}
