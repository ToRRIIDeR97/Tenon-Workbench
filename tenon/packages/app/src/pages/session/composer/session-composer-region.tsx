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
import { setCommandStripAnchor } from "@/features/command-centre/command-strip-anchor"
import type { SessionComposerFollowupDock } from "./session-composer-region-controller"
import type { SessionComposerRegionController } from "./session-composer-region-controller"

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionController
  promptInput: JSX.Element
  external?: boolean
}) {
  const language = useLanguage()
  const controller = props.controller
  const permissions = usePermission()
  const sdk = useSDK()
  const params = useParams<{ id?: string }>()
  const view = createMemo<"question" | "permission" | "composer">(() => {
    if (controller.state.questionRequest()) return "question"
    if (controller.state.permissionRequest()) return "permission"
    return controller.showComposer() ? "composer" : "permission"
  })
  const question = () => controller.state.questionRequest()
  const permission = () => controller.state.permissionRequest()
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

  const handedOff = !untrack(controller.promptReady)

  let dock: HTMLDivElement | undefined
  onMount(() => {
    if (!dock) return
    const element = dock
    createResizeObserver(element, () => {
      const main = element.closest("main")?.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      setCommandStripAnchor({
        lift: Math.round((main?.bottom ?? window.innerHeight) - rect.top),
        center: Math.round(rect.left - (main?.left ?? 0) + rect.width / 2),
        span: Math.max(0, Math.round(rect.width - 32)),
      })
    })
    onCleanup(() => setCommandStripAnchor(undefined))
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
      <div class="pointer-events-none absolute inset-x-0 bottom-full h-6 bg-linear-to-t from-v2-background-bg-base to-transparent" />
      <div
        data-slot="thread-column"
        classList={{
          "w-full px-3 pointer-events-auto flex flex-col": true,
          "md:max-w-[var(--tenon-thread-width,640px)] md:mx-auto": controller.centered(),
        }}
      >
        <div ref={swap} class="mx-auto flex w-full max-w-[560px] flex-col">
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
                  onAllowThread={() => {
                    controller.onResponseSubmit()
                    permissions.setMode(params.id ?? request.sessionID, sdk().directory, "full")
                  }}
                />
              </div>
            )}
          </Show>

          <Show when={view() === "composer"}>
            <div class={`flex flex-col ${enter()}`}>
              <Show
                when={controller.promptReady()}
                fallback={
                  <div>
                    <SessionRevertTray dock={controller.revert} />
                    <div class="w-full min-h-32 md:min-h-40 rounded-[28px] bg-v2-background-bg-layer-01 px-5 py-4 text-v2-text-text-muted whitespace-pre-wrap pointer-events-none">
                      {controller.handoffPrompt() || language.t("prompt.loading")}
                    </div>
                  </div>
                }
              >
                <div
                  classList={{
                    "relative z-(--z-composer)": true,
                    "animate-enter": handedOff,
                  }}
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

export function SessionTodoTray(props: { controller: SessionComposerRegionController }) {
  const language = useLanguage()
  return (
    <Show when={props.controller.dock()}>
      <div
        class="flex flex-col justify-end overflow-hidden"
        classList={{ "pointer-events-none": props.controller.dockProgress() < 0.98 }}
        style={{ "max-height": `${props.controller.dockHeight() * props.controller.dockProgress()}px` }}
      >
        <div ref={props.controller.setDockBodyRef} class="shrink-0">
          <SessionTodoDock
            todos={props.controller.state.todos()}
            collapsed={props.controller.todo.collapsed()}
            onToggle={props.controller.todo.onToggle}
            collapseLabel={language.t("session.todo.collapse")}
            expandLabel={language.t("session.todo.expand")}
            dockProgress={props.controller.dockProgress()}
          />
        </div>
      </div>
    </Show>
  )
}
