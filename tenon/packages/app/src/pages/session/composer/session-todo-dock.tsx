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
    height: undefined as number | undefined,
  })

  const total = createMemo(() => props.todos.filter((todo) => todo.status !== "cancelled").length)
  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const finished = createMemo(() => total() > 0 && done() >= total())
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

  const collapse = useSpring(() => (props.collapsed ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const shut = createMemo(() => 1 - Math.max(0, Math.min(1, props.dockProgress)))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
  let contentRef: HTMLDivElement | undefined

  createEffect(() => {
    const el = contentRef
    if (!el) return
    const update = () => {
      if (el.scrollHeight > 0) setStore("height", el.scrollHeight)
    }
    update()
    createResizeObserver(el, update)
  })

  return (
    <div
      data-component="session-todo-dock"
      class="flex min-w-0 flex-col justify-end overflow-hidden"
      style={{ "max-height": todoDockMaxHeight(store.height, value()), opacity: `${1 - shut()}` }}
    >
      <div ref={contentRef} class="flex min-w-0 shrink-0 flex-col">
        <div
          data-slot="session-todo-list"
          aria-hidden={props.collapsed || off()}
          classList={{ "pointer-events-none": hide() > 0.1 }}
          style={{ visibility: off() ? "hidden" : "visible", opacity: `${1 - hide()}` }}
        >
          <TodoList todos={props.todos} />
        </div>
        <div
          data-action="session-todo-toggle"
          class="relative flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-[12px] pl-4 pr-2 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
          role="button"
          tabIndex={0}
          aria-label={label()}
          aria-expanded={!props.collapsed}
          onClick={props.onToggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            props.onToggle()
          }}
        >
          <span class="flex shrink-0" aria-hidden="true">
            <TodoMark status={finished() ? "completed" : "in_progress"} />
          </span>
          <div data-slot="session-todo-preview" class="min-w-0 flex-1 overflow-hidden">
            <TextReveal
              class="cursor-default text-[13px] leading-5 [font-weight:500] text-v2-text-text-base"
              text={active()?.content ?? language.t("session.todo.title")}
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
                size="small"
                variant="ghost-muted"
                style={{ transform: `rotate(${value() * 180}deg)` }}
                tabIndex={-1}
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
          <span
            aria-hidden="true"
            class="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full bg-v2-border-border-muted"
          >
            <span
              class="block h-full rounded-full bg-v2-icon-icon-accent transition-[width] duration-long ease-emphasized-decelerate motion-reduce:transition-none"
              style={{ width: `${total() ? Math.round((done() / total()) * 100) : 0}%` }}
            />
          </span>
        </div>
      </div>
    </div>
  )
}

const ROW = 36

export function todoDockMaxHeight(measured: number | undefined, collapse: number) {
  if (measured === undefined) return collapse > 0 ? `${ROW}px` : undefined
  const full = Math.max(ROW, measured)
  return `${full - collapse * (full - ROW)}px`
}

function TodoList(props: { todos: Todo[] }) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    stuck: false,
  })

  return (
    <div class="relative">
      <div
        class="px-3 pt-2.5 pb-1 flex flex-col max-h-48 overflow-y-auto"
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
          background: "linear-gradient(to bottom, var(--v2-background-bg-layer-02), transparent)",
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
            stroke="var(--v2-background-bg-layer-02)"
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
