import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import { useCommandCentre } from "./command-centre"

/**
 * K3 · Slim strip. A handle just above the bottom edge of every page but the Command Centre; Ctrl/Cmd+J
 * or a click opens a strip (at most 90 px) with the latest reply on one line, a composer that sends to
 * the latest Command Centre thread, Undo when that reply made a write, and "Open full". Esc hides it. The strip
 * rises and fades in over 300 ms emphasized-decelerate and drops out over 200 ms emphasized-accelerate; reduced
 * motion snaps.
 */
export function CommandStrip() {
  const language = useLanguage()
  const navigate = useNavigate()
  const command = useCommand()
  const centre = useCommandCentre()
  const server = useServer()
  const [state, setState] = createStore({ open: false })
  let input: HTMLTextAreaElement | undefined
  let card: HTMLDivElement | undefined
  let full: HTMLButtonElement | undefined
  // Focus goes back where it was when the strip closes, so keyboard users are not dropped on <body>.
  let returnFocus: HTMLElement | undefined

  const toggle = () => setState("open", (open) => !open)
  command.register("command-strip", () => [
    {
      id: "commandCentre.strip.toggle",
      title: language.t("secondBrain.commandCentre.strip.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+j",
      onSelect: toggle,
    },
  ])
  createEffect(() => {
    if (state.open) {
      // An old failure shouldn't hide the latest reply.
      centre.clearError()
      if (!card?.contains(document.activeElement)) returnFocus = document.activeElement as HTMLElement | undefined
      // A disabled input (no workspace yet) can't take focus; "Open full" can.
      queueMicrotask(() => (input && !input.disabled ? input : full)?.focus())
      return
    }
    // Making the card inert can already have dropped focus to <body>.
    if (document.activeElement !== document.body && !card?.contains(document.activeElement)) return
    const target = returnFocus?.isConnected ? returnFocus : undefined
    returnFocus = undefined
    if (target) target.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  })
  makeEventListener(window, "keydown", (event) => {
    if (event.key !== "Escape" || !state.open || event.defaultPrevented) return
    event.preventDefault()
    setState("open", false)
  })

  // Each request from the strip is a fresh Command Centre thread. The text stays if sending fails.
  const composer = createComposerController({
    send: async (text) => !!(await centre.send(text, null)),
    disabled: () => !centre.directory(),
    blocked: centre.sending,
  })
  const openFull = () => {
    const id = centre.latest()?.id
    setState("open", false)
    navigate(id ? sessionHref(server.key, id) : "/command")
  }

  return (
    // Sits on the page panel's bottom edge (main ends 8px below the panel). The handle stays in place and
    // the strip rises from it as a floating card, so nothing swaps or clips mid-animation.
    <div
      data-command-strip
      data-state={state.open ? "open" : "closed"}
      // Only the handle and the open card take the pointer; the rest of the band stays the page's.
      // On a thread the composer owns the page's bottom edge, so the strip sits on top of it.
      class="pointer-events-none absolute bottom-[calc(0.5rem+var(--command-strip-lift,0px))] left-1/2 z-(--z-command-strip) h-5 w-[min(680px,calc(100%-32px))] -translate-x-1/2"
    >
      <button
        type="button"
        tabIndex={state.open ? -1 : undefined}
        classList={{
          "group mx-auto flex h-5 w-28 items-center justify-center rounded-t-[10px] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:duration-0": true,
          "opacity-0 duration-short ease-standard": state.open,
          "pointer-events-auto opacity-100 duration-medium ease-standard": !state.open,
        }}
        aria-label={language.t("secondBrain.commandCentre.strip.open")}
        aria-hidden={state.open ? true : undefined}
        onClick={() => setState("open", true)}
      >
        <span class="h-1 w-12 rounded-full bg-v2-border-border-strong transition-colors duration-short ease-standard group-hover:bg-v2-icon-icon-muted motion-reduce:transition-none" />
      </button>
      <div
        data-command-strip-card
        ref={card}
        inert={state.open ? undefined : true}
        classList={{
          "absolute inset-x-0 bottom-1.5 origin-bottom motion-reduce:duration-0": true,
          // Visibility isn't transitioned on open: at the transition's first frame it still reads hidden, and the
          // field couldn't take focus.
          "pointer-events-auto translate-y-0 scale-100 opacity-100 transition-[opacity,translate,scale] duration-medium ease-emphasized-decelerate":
            state.open,
          // Hidden once the exit finishes (visibility flips at the end), so the closed card's input is not
          // reachable by role queries, assistive tech or clicks.
          "invisible translate-y-3 scale-[0.97] opacity-0 transition-[opacity,translate,scale,visibility] duration-exit ease-emphasized-accelerate":
            !state.open,
        }}
      >
        <div class="flex flex-col gap-1 rounded-[16px] bg-v2-background-bg-floating px-3 py-2 shadow-[var(--v2-elevation-floating)]">
          <div class="flex h-7 min-w-0 items-center gap-2">
            <p
              class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted"
              title={centre.lastReply() || undefined}
            >
              {centre.error()
                ? language.t("common.requestFailed")
                : centre.waiting()
                  ? language.t("secondBrain.commandCentre.strip.waiting")
                  : centre.lastReply() || language.t("secondBrain.commandCentre.strip.empty")}
            </p>
            {/* Undo for the latest reply's last write; after it the button reports how that went. */}
            <Show when={centre.lastWrite()} keyed>
              {(write) => (
                <Show
                  when={write.undoState === "idle" || write.undoState === "pending"}
                  fallback={
                    <span class="shrink-0 type-meta text-v2-text-text-muted" role="status">
                      {language.t(
                        write.undoState === "undone"
                          ? "secondBrain.agentWrites.undone"
                          : write.undoState === "changed"
                            ? "secondBrain.agentWrites.changed"
                            : "secondBrain.agentWrites.undoFailed",
                      )}
                    </span>
                  }
                >
                  <ButtonV2
                    size="small"
                    variant="ghost"
                    data-action="command-strip-undo"
                    disabled={write.undoState === "pending"}
                    onClick={() => void centre.undo(write.id)}
                  >
                    {language.t("secondBrain.agentWrites.undo")}
                  </ButtonV2>
                </Show>
              )}
            </Show>
            <ButtonV2 ref={full} size="small" variant="ghost" onClick={openFull}>
              {language.t("secondBrain.commandCentre.strip.openFull")}
            </ButtonV2>
          </div>
          <ComposerBox
            size="compact"
            ref={(element) => (input = element)}
            controller={composer}
            label={language.t("secondBrain.commandCentre.composer.label")}
            placeholder={language.t("secondBrain.commandCentre.composer.placeholder")}
            sendLabel={language.t("secondBrain.commandCentre.composer.send")}
          />
        </div>
      </div>
    </div>
  )
}
