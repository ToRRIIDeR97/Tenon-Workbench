import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"
import { PromptDictationButton } from "@/components/prompt-input/dictation-button"
import { composerKeySends, type ComposerController } from "@/components/prompt-input/composer-controller"
import { usePlatform } from "@/context/platform"

/**
 * The composer for Home, the Command Centre page and the command strip: a text box that grows with its
 * text, Enter to send (Shift+Enter for a new line), dictation when the platform has it, and a send button.
 * `large` and `medium` stack the text above a control row; `compact` keeps everything on one line.
 * Thread composers use `PromptInputV2Composer`, which adds attachments, history and skills. With `onExpand`, the box
 * hands off to that composer: its + button, or typing a / or @ trigger, moves the text there.
 */
export function ComposerBox(props: {
  controller: ComposerController
  /** The text box's accessible name. */
  label: string
  placeholder: string
  /** The send button's accessible name and tooltip. */
  sendLabel: string
  size?: "large" | "medium" | "compact"
  /** A row above the text, such as Home's folder and branch. */
  header?: JSX.Element
  /** Controls at the start of the bottom row, such as the model pill. */
  controls?: JSX.Element
  /** Moves the text to the full composer. Needs `expandLabel`. */
  onExpand?: (text: string) => void
  expandLabel?: string
  ref?: (element: HTMLTextAreaElement) => void
  /** Handles a key in the text box before the box does (Enter sends); return true when it took the key. */
  onKeyDown?: (event: KeyboardEvent) => boolean
  class?: string
}) {
  const platform = usePlatform()
  const size = () => props.size ?? "medium"
  let field: HTMLTextAreaElement | undefined

  const actions = (
    <>
      <Show when={platform.dictation}>
        {(dictation) => <PromptDictationButton dictation={dictation()} restoreFocus={() => field?.focus()} />}
      </Show>
      <TooltipV2 placement="top" value={props.sendLabel}>
        <IconButtonV2
          type="submit"
          variant="contrast"
          data-slot="composer-send"
          size={size() === "compact" ? "normal" : "large"}
          class={size() === "compact" ? undefined : "!size-9"}
          aria-label={props.sendLabel}
          icon={<Icon name="arrow-up" />}
          disabled={!props.controller.canSend()}
        />
      </TooltipV2>
    </>
  )

  return (
    <form
      data-component="composer-box"
      data-size={size()}
      class={props.class}
      classList={{
        "flex min-w-0 overflow-hidden bg-v2-background-bg-raised transition-shadow duration-short ease-standard motion-reduce:transition-none": true,
        "flex-col shadow-[0_0_0_1px_var(--v2-border-border-base),0_8px_24px_-12px_rgb(0_0_0/0.14)] focus-within:shadow-[0_0_0_2px_var(--v2-border-border-focus),0_8px_24px_-12px_rgb(0_0_0/0.14)]":
          size() !== "compact",
        "rounded-[28px]": size() === "large",
        "rounded-[20px]": size() === "medium",
        "items-center gap-1 rounded-full py-0.5 pl-1 pr-0.5 shadow-[0_0_0_1px_var(--v2-border-border-base)] focus-within:shadow-[0_0_0_2px_var(--v2-border-border-focus)]":
          size() === "compact",
      }}
      onSubmit={(event) => {
        event.preventDefault()
        void props.controller.send()
      }}
    >
      {props.header}
      <textarea
        ref={(element) => {
          field = element
          props.ref?.(element)
        }}
        rows={size() === "large" ? 2 : 1}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.controller.value()}
        disabled={props.controller.disabled()}
        classList={{
          "w-full min-w-0 resize-none bg-transparent text-v2-text-text-base outline-none [field-sizing:content] placeholder:text-v2-text-text-faint disabled:cursor-not-allowed": true,
          "max-h-60 min-h-[clamp(60px,9vh,112px)] px-5 pt-4 text-[15px] leading-6": size() === "large",
          "max-h-40 min-h-11 px-4 pt-3 text-[13px] leading-5": size() === "medium",
          "max-h-20 flex-1 px-3 py-1.5 text-[13px] leading-5": size() === "compact",
        }}
        onInput={(event) => {
          const text = event.currentTarget.value
          props.controller.setValue(text)
          if (/(^|\s)[/@]$/.test(text)) props.onExpand?.(text)
        }}
        onKeyDown={(event) => {
          if (props.onKeyDown?.(event)) return
          if (!composerKeySends(event)) return
          event.preventDefault()
          void props.controller.send()
        }}
      />
      <Show when={size() !== "compact"} fallback={actions}>
        <div class="flex min-w-0 items-center gap-1 pb-2 pl-2.5 pr-2">
          <Show when={props.onExpand}>
            {(expand) => (
              <TooltipV2 placement="top" value={props.expandLabel}>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  aria-label={props.expandLabel}
                  icon={<Icon name="plus" size="small" />}
                  onClick={() => expand()(props.controller.value())}
                />
              </TooltipV2>
            )}
          </Show>
          {props.controls}
          <span class="flex-1" />
          {actions}
        </div>
      </Show>
    </form>
  )
}
