import { Show, createComputed, createEffect, createMemo, on, onCleanup, onMount, untrack, type JSX } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Reveal } from "@tenon/ui/v2/reveal"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useParams } from "@solidjs/router"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertTray } from "@/pages/session/composer/session-revert-dock"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import type { SessionComposerFollowupDock } from "./session-composer-region-controller"
import type { SessionComposerRegionController } from "./session-composer-region-controller"

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionController
  promptInput: JSX.Element
  /** The thread runs on Codex or an ACP agent, which can't read a deny reason from the approval reply. */
  external?: boolean
}) {
  const language = useLanguage()
  const controller = props.controller
  const permissions = usePermission()
  const sdk = useSDK()
  const params = useParams<{ id?: string }>()
  // A question or approval takes the composer's place. Only one of the three shows at a time: the incoming one
  // fades and rises in (animate-enter) while the area's height eases once from the old content's height to the
  // new one's, so the region never grows past either (both showing at once made it jump up, then back down).
  const view = createMemo<"question" | "permission" | "composer">(() => {
    if (controller.state.questionRequest()) return "question"
    if (controller.state.permissionRequest()) return "permission"
    return controller.showComposer() ? "composer" : "permission"
  })
  const question = () => controller.state.questionRequest()
  const permission = () => controller.state.permissionRequest()
  // The first content shows as it is; only later swaps animate.
  let swapped = false
  let swap: HTMLDivElement | undefined
  let from = 0
  createComputed(
    on(
      view,
      () => {
        from = swap?.getBoundingClientRect().height ?? 0
        swapped = true
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      view,
      () => {
        const element = swap
        if (!element || prefersReducedMotion()) return
        const to = element.getBoundingClientRect().height
        if (!from || Math.abs(to - from) < 1) return
        element.style.overflow = "hidden"
        const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration: motionDuration("medium"),
          easing: getComputedStyle(element).getPropertyValue("--v2-ease-emphasized-decelerate").trim() || "ease-out",
        })
        const done = () => (element.style.overflow = "")
        animation.onfinish = done
        animation.oncancel = done
      },
      { defer: true },
    ),
  )
  const enter = () => (swapped ? "animate-enter" : "")
  const followup = createMemo<SessionComposerFollowupDock | undefined>((last) =>
    controller.followup()?.items.length ? controller.followup() : last,
  )

  // A composer that replaces the handoff placeholder (the prompt was still loading) fades in over it; one
  // that is ready from the start does not.
  const handedOff = !untrack(controller.promptReady)

  let dock: HTMLDivElement | undefined
  onMount(() => {
    if (!dock) return
    const element = dock
    const root = document.documentElement
    // The Command Centre strip handle sits on the composer's top edge, centred on the chat column (not the
    // window), so it never lands on the side panel or terminal beside the thread.
    createResizeObserver(element, () => {
      const main = element.closest("main")?.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      root.style.setProperty("--command-strip-lift", `${Math.round((main?.bottom ?? window.innerHeight) - rect.top)}px`)
      root.style.setProperty(
        "--command-strip-center",
        `${Math.round(rect.left - (main?.left ?? 0) + rect.width / 2)}px`,
      )
      root.style.setProperty("--command-strip-span", `${Math.max(0, Math.round(rect.width - 32))}px`)
    })
    onCleanup(() => {
      root.style.removeProperty("--command-strip-lift")
      root.style.removeProperty("--command-strip-center")
      root.style.removeProperty("--command-strip-span")
    })
  })

  return (
    <div
      ref={(element) => {
        dock = element
        controller.setDockRef(element)
      }}
      data-component="session-prompt-dock"
      class="relative w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none bg-v2-background-bg-base"
    >
      {/* The thread fades out above the composer instead of stopping at a hard edge. */}
      <div class="pointer-events-none absolute inset-x-0 bottom-full h-6 bg-linear-to-t from-v2-background-bg-base to-transparent" />
      {/* The thread's column: the Environment window measures it to stay clear of the thread's text. */}
      <div
        data-slot="thread-column"
        classList={{
          "w-full px-3 pointer-events-auto flex flex-col": true,
          "md:max-w-[640px] md:mx-auto": controller.centered(),
        }}
      >
        <div ref={swap} class="flex flex-col">
          <Show when={view() === "question" ? question() : undefined} keyed>
            {(request) => (
              <div class={enter()}>
                <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />
              </div>
            )}
          </Show>

          <Show when={view() === "permission" ? permission() : undefined} keyed>
            {(request) => (
              <div class={enter()}>
                <SessionPermissionDock
                  request={request}
                  responding={controller.state.permissionResponding()}
                  onDecide={(response, message) => {
                    controller.onResponseSubmit()
                    controller.state.decide(response, message, props.external)
                  }}
                  // Full auto answers this request and every later one in the thread, subagents included.
                  onAllowThread={() => {
                    controller.onResponseSubmit()
                    permissions.setMode(params.id ?? request.sessionID, sdk().directory, "full")
                  }}
                />
              </div>
            )}
          </Show>

          <Show when={view() === "composer"}>
            {/* Flex so the docks' negative margins add up instead of collapsing into each other. */}
            <div class={`flex flex-col ${enter()}`}>
              <Show when={controller.dock()}>
                <div
                  classList={{
                    "overflow-hidden": true,
                    "pointer-events-none": controller.dockProgress() < 0.98,
                  }}
                  style={{
                    "max-height": `${controller.dockHeight() * controller.dockProgress()}px`,
                  }}
                >
                  <div ref={controller.setDockBodyRef}>
                    <SessionTodoDock
                      todos={controller.state.todos()}
                      collapsed={controller.todo.collapsed()}
                      onToggle={controller.todo.onToggle}
                      collapseLabel={language.t("session.todo.collapse")}
                      expandLabel={language.t("session.todo.expand")}
                      dockProgress={controller.dockProgress()}
                    />
                  </div>
                </div>
              </Show>
              <Show
                when={controller.promptReady()}
                fallback={
                  <div style={{ "margin-top": `${-36 * controller.dockProgress()}px` }}>
                    {/* The live composer carries the rollback rows in its own tray; the placeholder stands in for it. */}
                    <SessionRevertTray dock={controller.revert} />
                    <div class="w-full min-h-32 md:min-h-40 rounded-[28px] bg-v2-background-bg-layer-01 px-5 py-4 text-v2-text-text-muted whitespace-pre-wrap pointer-events-none">
                      {controller.handoffPrompt() || language.t("prompt.loading")}
                    </div>
                  </div>
                }
              >
                {/* The rollback rows live in the composer's tray (its header), so they fold in with the tray
                  and the composer below them never jumps. */}
                <div
                  classList={{
                    "relative z-(--z-composer)": true,
                    "animate-enter": handedOff,
                  }}
                  style={{ "margin-top": `${-36 * controller.dockProgress()}px` }}
                >
                  <Reveal open={!!controller.followup()?.items.length}>
                    <Show when={followup()}>
                      {(dock) => (
                        <SessionFollowupDock items={dock().items} pending={dock().pending} actions={dock().actions} />
                      )}
                    </Show>
                  </Reveal>
                  <Show when={controller.child()} fallback={props.promptInput}>
                    <div
                      ref={controller.setPromptRef}
                      class="w-full rounded-[28px] bg-v2-background-bg-layer-01 px-5 py-4 text-[14px] text-v2-text-text-muted"
                    >
                      <span>{language.t("session.child.promptDisabled")} </span>
                      <Show when={controller.parentID()}>
                        <button
                          type="button"
                          class="rounded-full text-v2-text-text-accent transition-colors duration-short ease-standard hover:text-v2-text-text-accent-hover [font-weight:500] motion-reduce:transition-none"
                          onClick={controller.openParent}
                        >
                          {language.t("session.child.backToParent")}
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
