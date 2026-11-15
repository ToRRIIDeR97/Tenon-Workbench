import type { Todo } from "@opencode-ai/sdk/v2"
import { AnimatedNumber } from "@tenon/ui/animated-number"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { useSpring } from "@tenon/ui/motion-spring"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { TextReveal } from "@tenon/ui/text-reveal"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Index, Match, Switch, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"

const doneToken = "\u0000done\u0000"
const totalToken = "\u0000total\u0000"

export function SessionTodoDock(props: {
  todos: Todo[]
  collapsed: boolean
  onToggle: () => void
  collapseLabel: string
  expandLabel: string
  dockProgress: number
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    height: 78,
  })

  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const label = createMemo(() => language.t("session.todo.progress", { done: done(), total: total() }))
  const progress = createMemo(() =>
    language
      .t("secondBrain.todo.count", { done: doneToken, total: totalToken })
      .split(/(\u0000done\u0000|\u0000total\u0000)/),
  )

  const active = createMemo(
    () =>
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos.filter((todo) => todo.status === "completed").at(-1) ??
      props.todos[0],
  )

  const preview = createMemo(() => active()?.content ?? "")
  const collapse = useSpring(() => (props.collapsed ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const dock = createMemo(() => Math.max(0, Math.min(1, props.dockProgress)))
  const shut = createMemo(() => 1 - dock())
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
  const turn = createMemo(() => Math.max(0, Math.min(1, value())))
  const full = createMemo(() => Math.max(78, store.height))
  let contentRef: HTMLDivElement | undefined

  createEffect(() => {
    const el = contentRef
    if (!el) return
    const update = () => {
      setStore("height", (height) => Math.max(height, el.scrollHeight))
    }
    update()
    createResizeObserver(el, update)
  })

  return (
    <div
      data-component="session-todo-dock"
      class="w-full overflow-hidden rounded-[24px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
      style={{
        "overflow-x": "visible",
        "overflow-y": "hidden",
        "max-height": `${Math.max(78, full() - value() * (full() - 78))}px`,
      }}
    >
      <div ref={contentRef}>
        <div
          data-action="session-todo-toggle"
          class="flex items-center gap-2 overflow-visible h-[42px] pl-[18px] pr-2"
          role="button"
          tabIndex={0}
          onClick={props.onToggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            props.onToggle()
          }}
        >
          <span
            class="cursor-default shrink-0 text-[13px] leading-5 [font-weight:600] text-v2-text-text-base"
            aria-label={label()}
            style={{ opacity: `${Math.max(0, Math.min(1, 1 - shut()))}` }}
          >
            {language.t("session.todo.title")}
          </span>
          <div
            data-slot="session-todo-preview"
            class="ml-1 min-w-0 overflow-hidden"
            style={{
              flex: "1 1 auto",
              "max-width": "100%",
            }}
          >
            <TextReveal
              class="cursor-default text-[13px] leading-5 text-v2-text-text-muted"
              text={props.collapsed ? preview() : undefined}
              duration="var(--v2-duration-long)"
              travel={25}
              edge={17}
              spring="var(--v2-ease-emphasized-decelerate)"
              springSoft="var(--v2-ease-emphasized-decelerate)"
              growOnly
              truncate
            />
          </div>
          <span
            class="cursor-default inline-flex shrink-0 items-baseline overflow-visible text-[12px] leading-5 tabular-nums text-v2-text-text-muted"
            aria-hidden="true"
            style={{
              "--tool-motion-odometer-ms": "var(--v2-duration-long)",
              "--tool-motion-mask": "18%",
              "--tool-motion-mask-height": "0px",
              "--tool-motion-spring-ms": "var(--v2-duration-long)",
              "white-space": "pre",
              opacity: `${Math.max(0, Math.min(1, 1 - shut()))}`,
            }}
          >
            <Index each={progress()}>
              {(item) =>
                item() === doneToken ? (
                  <AnimatedNumber value={done()} />
                ) : item() === totalToken ? (
                  <AnimatedNumber value={total()} />
                ) : (
                  <span>{item()}</span>
                )
              }
            </Index>
          </span>
          <div class="shrink-0">
            <TooltipV2 placement="top" value={props.collapsed ? props.expandLabel : props.collapseLabel}>
              <IconButtonV2
                data-action="session-todo-toggle-button"
                data-collapsed={props.collapsed ? "true" : "false"}
                icon={<Icon name="outline-chevron-down" size="small" />}
                size="normal"
                variant="ghost-muted"
                style={{ transform: `rotate(${turn() * 180}deg)` }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onToggle()
                }}
                aria-label={props.collapsed ? props.expandLabel : props.collapseLabel}
              />
            </TooltipV2>
          </div>
        </div>

        <div
          data-slot="session-todo-list"
          aria-hidden={props.collapsed || off()}
          classList={{
            "pointer-events-none": hide() > 0.1,
          }}
          style={{
            visibility: off() ? "hidden" : "visible",
            opacity: `${Math.max(0, Math.min(1, 1 - hide()))}`,
          }}
        >
          <TodoList todos={props.todos} />
        </div>
      </div>
    </div>
  )
}

/**
 * The steps, in the workshop's variant A: a filled check for a finished step (its text dimmed), the spinner on the
 * step in progress, and a dashed circle for one still to come; a cancelled step is dimmed and struck through.
 * Status is told by the mark's shape, never by colour alone.
 */
function TodoList(props: { todos: Todo[] }) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    stuck: false,
  })

  return (
    <div class="relative">
      <div
        class="px-3.5 pb-11 flex flex-col max-h-48 overflow-y-auto"
        style={{ "overflow-anchor": "none" }}
        onScroll={(e) => {
          setStore("stuck", e.currentTarget.scrollTop > 0)
        }}
      >
        <Index each={props.todos}>
          {(todo) => (
            <div
              data-slot="session-todo-item"
              data-state={todo().status}
              class="flex items-start gap-2.5 px-1 py-[3px] text-[13px] leading-5 transition-colors duration-short ease-standard motion-reduce:transition-none"
              classList={{
                "text-v2-text-text-muted": todo().status === "completed" || todo().status === "cancelled",
                "text-v2-text-text-base": todo().status === "pending" || todo().status === "in_progress",
                "[font-weight:500]": todo().status === "in_progress",
              }}
            >
              <span class="mt-0.5 shrink-0" role="img" aria-label={language.t(statusLabel(todo().status))}>
                <TodoMark status={todo().status} />
              </span>
              <span class="min-w-0 break-words" classList={{ "line-through": todo().status === "cancelled" }}>
                {todo().content}
              </span>
            </div>
          )}
        </Index>
      </div>
      <div
        class="pointer-events-none absolute top-0 left-0 right-0 h-4 transition-opacity motion-reduce:transition-none"
        style={{
          background: "linear-gradient(to bottom, var(--v2-background-bg-layer-01), transparent)",
          opacity: store.stuck ? 1 : 0,
        }}
      />
    </div>
  )
}

function statusLabel(status: string) {
  if (status === "completed") return "secondBrain.todo.status.completed" as const
  if (status === "in_progress") return "secondBrain.todo.status.inProgress" as const
  if (status === "cancelled") return "secondBrain.todo.status.cancelled" as const
  return "secondBrain.todo.status.pending" as const
}

/** A step's status mark: 16px, drawn in the icon colours so it follows the theme. */
function TodoMark(props: { status: string }) {
  return (
    <Switch
      fallback={
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-v2-icon-icon-muted" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.4 2.2" />
        </svg>
      }
    >
      <Match when={props.status === "completed"}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-v2-icon-icon-muted" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M5 8.2l2 2 4-4.2"
            stroke="var(--v2-background-bg-layer-01)"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Match>
      <Match when={props.status === "in_progress"}>
        <LoaderV2 class="text-v2-icon-icon-accent" />
      </Match>
    </Switch>
  )
}
