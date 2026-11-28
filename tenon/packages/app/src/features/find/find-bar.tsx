import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
  useContext,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { useCommand, matchKeybind, parseKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { popoverSurfaceClass } from "@/components/surface-classes"
import { pickFindTarget } from "./find-targets"
import { stepIndex } from "./find-text"
import { clearPaint, domRanges, paintRanges, revealInTextarea, revealRange, textareaRanges } from "./dom-find"

export const FIND_COMMAND = "find.open"
export const FIND_KEYBIND = "mod+f"

export type FindTarget = {
  id: string
  layer: number
  root: () => HTMLElement | undefined
  enabled?: () => boolean
  insideOnly?: boolean
  mount?: () => HTMLElement | undefined
  revision?: () => unknown
  placement?: "inside" | "above"
  search: (query: string) => number
  select: (index: number) => void
  clear: () => void
}

type FindState = { open: boolean; query: string; count: number; index: number; targetID: string }

type FindContext = {
  register: (target: FindTarget) => () => void
  open: (targetID?: string) => void
  close: () => void
  matchesKey: (event: KeyboardEvent) => boolean
}

const Context = createContext<FindContext>()

export const useFind = () => useContext(Context)

export function useFindTarget(target: FindTarget) {
  const find = useFind()
  if (!find) return
  const unregister = find.register(target)
  onCleanup(unregister)
}

function selectionQuery() {
  const text = window.getSelection()?.toString().trim() ?? ""
  return text && text.length <= 120 && !text.includes("\n") ? text : ""
}

export function FindProvider(props: ParentProps) {
  const command = useCommand()
  const settings = useSettings()
  const [targets, setTargets] = createSignal<FindTarget[]>([])
  const [state, setState] = createStore<FindState>({ open: false, query: "", count: 0, index: -1, targetID: "" })
  const target = createMemo(() => targets().find((item) => item.id === state.targetID))

  const register = (next: FindTarget) => {
    setTargets((list) => [...list.filter((item) => item.id !== next.id), next])
    return () => {
      setTargets((list) => list.filter((item) => item !== next))
      if (untrack(() => state.targetID) === next.id) {
        next.clear()
        setState({ open: false, count: 0, index: -1, targetID: "" })
      }
    }
  }

  const run = (query: string, keep = false) => {
    const current = untrack(target)
    if (!current) return
    const count = query.trim() ? current.search(query) : 0
    const index =
      count === 0
        ? -1
        : keep
          ? Math.min(
              Math.max(
                untrack(() => state.index),
                0,
              ),
              count - 1,
            )
          : 0
    setState({ query, count, index })
    if (index < 0) current.clear()
    else current.select(index)
  }

  const open = (targetID?: string) => {
    const list = untrack(targets)
    const focused = lastInside ?? document.activeElement
    const inside = (item: FindTarget, node: unknown) => node instanceof Node && !!item.root()?.contains(node)
    const chosen = targetID
      ? list.find((item) => item.id === targetID)
      : pickFindTarget(
          list.map((item) => ({
            ...item,
            contains: (node: unknown) => inside(item, node),
            enabled: () => item.enabled?.() !== false && (!item.insideOnly || inside(item, focused)),
          })),
          focused,
        )
    if (!chosen) return
    const previous = untrack(target)
    if (previous && previous.id !== chosen.id) previous.clear()
    const query = selectionQuery() || untrack(() => state.query)
    setState({ open: true, targetID: chosen.id, query })
    queueMicrotask(() => {
      run(query)
      input?.focus()
      input?.select()
    })
  }

  const close = () => {
    untrack(target)?.clear()
    setState({ open: false, count: 0, index: -1 })
    const root = untrack(target)?.root()
    if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true })
  }

  const step = (direction: 1 | -1) => {
    const current = untrack(target)
    if (!current || state.count === 0) return
    const index = stepIndex(state.count, state.index, direction)
    setState("index", index)
    current.select(index)
  }

  const keybind = () => settings.keybinds.get(FIND_COMMAND) ?? FIND_KEYBIND
  const matchesKey = (event: KeyboardEvent) => matchKeybind(parseKeybind(keybind()), event)

  const language = useLanguage()
  let input: HTMLInputElement | undefined

  command.register("find", () => [
    {
      id: FIND_COMMAND,
      title: language.t("secondBrain.find.open"),
      category: language.t("command.category.view"),
      keybind: FIND_KEYBIND,
      onSelect: () => open(),
    },
  ])

  let lastInside: EventTarget | null = null
  const remember = (event: Event) => {
    if (event.target instanceof Element && event.target.closest("[data-component=find-bar]")) return
    lastInside = event.target
  }
  makeEventListener(document, "pointerdown", remember, { capture: true })
  makeEventListener(document, "focusin", remember, { capture: true })

  makeEventListener(window, "keydown", (event) => {
    if (!state.open) return
    if (event.key === "F3") {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
  })

  createEffect(
    on(target, (current, previous) => {
      if (previous && !current) setState({ open: false, count: 0, index: -1 })
    }),
  )

  createEffect(
    on(
      () => (state.open ? target()?.revision?.() : undefined),
      (value, previous) => {
        if (value === undefined || previous === undefined || value === previous) return
        run(
          untrack(() => state.query),
          true,
        )
      },
    ),
  )

  const position = createMemo(() => {
    if (!state.open) return undefined
    const root = target()?.root()
    if (!root) return undefined
    const rect = root.getBoundingClientRect()
    const top = target()?.placement === "above" ? rect.top - 48 : rect.top + 8
    return { top: Math.max(8, top), right: Math.max(8, window.innerWidth - rect.right + 12) }
  })

  return (
    <Context.Provider value={{ register, open, close, matchesKey }}>
      {props.children}
      <Show when={state.open && target()}>
        {(current) => (
          <Portal mount={current().mount?.() ?? document.body}>
            <div
              role="search"
              aria-label={language.t("secondBrain.find.label")}
              data-component="find-bar"
              class={`${current().mount ? "absolute" : "fixed"} z-[60] flex items-center gap-1 ${popoverSurfaceClass} !p-1.5`}
              style={
                current().mount
                  ? { top: "12px", right: "56px" }
                  : { top: `${position()?.top ?? 8}px`, right: `${position()?.right ?? 12}px` }
              }
            >
              <span class="relative flex items-center">
                <Icon
                  name="magnifying-glass"
                  size="small"
                  class="pointer-events-none absolute left-2.5 text-v2-icon-icon-muted"
                />
                <input
                  ref={input}
                  type="search"
                  value={state.query}
                  aria-label={language.t("secondBrain.find.label")}
                  placeholder={language.t("secondBrain.find.placeholder")}
                  class="h-8 w-44 rounded-full border-0 bg-v2-background-bg-layer-01 pl-8 pr-3 text-[13px] text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] outline-none placeholder:text-v2-text-text-faint focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
                  onInput={(event) => run(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      step(event.shiftKey ? -1 : 1)
                    }
                    if (event.key === "Escape") {
                      event.preventDefault()
                      event.stopPropagation()
                      close()
                    }
                    if (matchesKey(event)) {
                      event.preventDefault()
                      event.stopPropagation()
                      event.currentTarget.select()
                    }
                  }}
                />
              </span>
              <span
                aria-live="polite"
                class="min-w-[72px] px-1 text-center text-[12px] tabular-nums text-v2-text-text-muted"
              >
                <Show when={state.query.trim()}>
                  {state.count === 0
                    ? language.t("secondBrain.find.none")
                    : language.t("secondBrain.find.count", { current: state.index + 1, total: state.count })}
                </Show>
              </span>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                aria-label={language.t("secondBrain.find.previous")}
                disabled={state.count === 0}
                icon={<Icon name="chevron-down" size="small" class="rotate-180" />}
                onClick={() => step(-1)}
              />
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                aria-label={language.t("secondBrain.find.next")}
                disabled={state.count === 0}
                icon={<Icon name="chevron-down" size="small" />}
                onClick={() => step(1)}
              />
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                aria-label={language.t("secondBrain.find.close")}
                icon={<Icon name="close-small" size="small" />}
                onClick={close}
              />
            </div>
          </Portal>
        )}
      </Show>
    </Context.Provider>
  )
}

export function createDomFindTarget(input: {
  id: string
  layer: number
  root: () => HTMLElement | undefined
  enabled?: () => boolean
  insideOnly?: boolean
  mount?: () => HTMLElement | undefined
  textarea?: () => HTMLTextAreaElement | undefined
}): FindTarget {
  let ranges: Range[] = []
  let spans: { start: number; end: number }[] = []
  const editor = () => {
    const area = input.textarea?.()
    return area && area.isConnected && area.checkVisibility?.() !== false ? area : undefined
  }
  return {
    id: input.id,
    layer: input.layer,
    root: input.root,
    enabled: input.enabled,
    insideOnly: input.insideOnly,
    mount: input.mount,
    search: (query) => {
      const area = editor()
      if (area) {
        ranges = []
        spans = textareaRanges(area, query)
        clearPaint()
        return spans.length
      }
      spans = []
      const root = input.root()
      ranges = root ? domRanges(root, query) : []
      return ranges.length
    },
    select: (index) => {
      const area = editor()
      if (area && spans.length) {
        revealInTextarea(area, spans[index])
        return
      }
      paintRanges(ranges, index)
      revealRange(ranges[index])
    },
    clear: () => {
      ranges = []
      spans = []
      clearPaint()
    },
  }
}
