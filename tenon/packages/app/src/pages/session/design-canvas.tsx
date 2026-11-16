import { createContext, createEffect, createMemo, on, untrack, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { DesignSpaceProvider } from "@tenon/session-ui/context/design"
import {
  collectDesigns,
  collectToolDesigns,
  designID,
  designFences,
  type CanvasDesign,
  type Design,
  type DesignFence,
} from "@tenon/session-ui/design-fence"
import { hasVisibleMarkup } from "@tenon/session-ui/design-stream"
import { promptLength } from "@/components/prompt-input/history"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { CANVAS_TAB } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { appendPromptText } from "@/utils/prompt"

/**
 * The design space of a session: what the thread's ```html design windows do ("Use this one",
 * "Open in Canvas"), and the Canvas tab's state. Designs are read from the thread, including canvas
 * blocks and `.html` writes that are still streaming; only the inline designs a user pinned and the
 * one shown large are kept, in memory. Designs are told apart by `key`, which stays the same while a
 * design streams and after it closes (its `id` changes at the close).
 */
function createDesignCanvas(panel: () => boolean) {
  const prompt = usePrompt()
  const command = useCommand()
  const language = useLanguage()
  const sync = useSync()
  const layout = useSessionLayout()
  const [store, setStore] = createStore({
    sessions: {} as Record<string, { pinned: Design[]; selected?: string }>,
  })
  // Designs (session:key) that already opened the panel once, while streaming or when they closed.
  const revealed = new Set<string>()
  // The source each streaming design had when this view first saw it: one that never grows here is history.
  const first = new Map<string, string>()
  const sessionID = () => layout.params.id
  const current = () => store.sessions[sessionID() ?? ""]
  const designs = createMemo(createDesignList(sync, sessionID, () => current()?.pinned ?? []))

  const show = (design: Design & { key?: string }) => {
    const id = sessionID()
    if (!id) return
    setStore("sessions", id, (state) => ({
      pinned:
        design.canvas || state?.pinned.some((item) => item.id === design.id)
          ? (state?.pinned ?? [])
          : [...(state?.pinned ?? []), design],
      selected: design.key ?? design.id,
    }))
    const view = layout.view()
    const tabs = layout.tabs()
    view.reviewPanel.open(view.reviewPanel.opened() ? "other" : "context-button")
    // Kept in the tab list as the mark that this thread has a canvas, so the rail shows its section.
    if (!tabs.all().includes(CANVAS_TAB)) tabs.setAll([...tabs.all(), CANVAS_TAB])
    tabs.setActive(CANVAS_TAB)
  }

  // A design streaming in this view opens the panel once, at its first frame with something to see.
  createEffect(() => {
    const id = sessionID()
    designs()
      .filter((design) => design.streaming)
      .forEach((design) => {
        const key = `${id}:${design.key}`
        const seen = first.get(key)
        if (seen === undefined) {
          first.set(key, design.source)
          return
        }
        if (revealed.has(key) || seen === design.source || !panel() || !hasVisibleMarkup(design.source)) return
        revealed.add(key)
        // Someone already looking at the board keeps it: its camera follows the new design instead.
        if (untrack(boardInView)) return
        show(design)
      })
  })
  const boardInView = () =>
    layout.view().reviewPanel.opened() && layout.tabs().active() === CANVAS_TAB && !current()?.selected
  createEffect(on(sessionID, () => first.clear(), { defer: true }))

  return {
    sessionID,
    /** The selected design's key (or the id of a pinned inline design). */
    selected: () => current()?.selected,
    select: (key: string | undefined) => {
      const id = sessionID()
      if (!id) return
      setStore("sessions", id, (state) => ({ pinned: state?.pinned ?? [], selected: key }))
    },
    /** Every canvas design of the current thread plus pinned inline ones. */
    designs,
    use: (design: Design) => {
      const title = design.title ?? language.t("secondBrain.canvas.untitled")
      const next = appendPromptText(prompt.current(), language.t("secondBrain.canvas.useReference", { title }))
      prompt.set(next, promptLength(next))
      command.trigger("input.focus")
    },
    open: (design: Design) => show(designs().find((item) => item.id === design.id) ?? design),
    /**
     * A canvas block finished streaming in the thread; a design that already opened the panel stays put,
     * and someone on the board keeps it (as when a design starts streaming).
     */
    reveal: (design: Design) => {
      const listed = designs().find((item) => item.id === design.id)
      const key = `${sessionID()}:${listed?.key ?? design.id}`
      if (revealed.has(key)) return
      revealed.add(key)
      if (untrack(boardInView)) return
      show(listed ?? design)
    },
  }
}

function createDesignList(
  sync: ReturnType<typeof useSync>,
  sessionID: () => string | undefined,
  pinned: () => Design[],
) {
  // Fence parsing per part, so a streaming reply only rescans the part that changed.
  const scanned = new Map<string, { text: string; fences: DesignFence[] }>()
  const scan = (part: { id: string; text: string }) => {
    const cached = scanned.get(part.id)
    if (cached?.text === part.text) return cached.fences
    const fences = designFences(part.text)
    scanned.set(part.id, { text: part.text, fences })
    return fences
  }
  // One object per design key while it doesn't change, so unchanged designs keep their identity.
  const known = new Map<string, CanvasDesign>()
  const stable = (design: CanvasDesign) => {
    const cached = known.get(design.key)
    if (
      cached &&
      cached.id === design.id &&
      cached.title === design.title &&
      cached.canvas === design.canvas &&
      cached.streaming === design.streaming &&
      cached.source === design.source
    )
      return cached
    known.set(design.key, design)
    return design
  }
  createEffect(
    on(
      sessionID,
      () => {
        scanned.clear()
        known.clear()
      },
      { defer: true },
    ),
  )
  return () => {
    const id = sessionID()
    if (!id) return []
    const keep = pinned()
    const messages = sync().data.message[id] ?? []
    // Parts (and tool calls) of replies still in progress: only their open designs are drawing.
    const live = new Set(
      messages
        .filter((message) => message.role === "assistant" && !message.time.completed && !message.error)
        .flatMap((message) =>
          (sync().data.part[message.id] ?? []).flatMap((part) =>
            part.type === "tool" ? [part.id, part.callID] : [part.id],
          ),
        ),
    )
    // An open fence or call in a reply that ended (stopped, out of tokens) is done with what it has.
    const settle = (design: CanvasDesign, owner: string): CanvasDesign =>
      design.streaming && !live.has(owner) ? { ...design, id: designID(design.source), streaming: false } : design
    const found = [
      ...collectDesigns(
        messages,
        sync().data.part,
        keep.map((design) => design.id),
        scan,
        { streaming: true },
      ).map((design) => settle(design, design.key.slice(0, design.key.lastIndexOf(":")))),
      ...collectToolDesigns(messages, sync().data.part).map((design) => settle(design, design.key)),
    ]
    const ids = new Set(found.map((design) => design.id))
    return [
      ...found,
      ...keep.filter((design) => !ids.has(design.id)).map((design): CanvasDesign => ({ ...design, key: design.id })),
    ].map(stable)
  }
}

const Context = createContext<ReturnType<typeof createDesignCanvas>>()

export function DesignCanvasProvider(props: ParentProps) {
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const canvas = createDesignCanvas(isDesktop)
  // The Canvas tab lives in the desktop side panel of a saved session.
  const panel = createMemo(() => isDesktop() && !!canvas.sessionID())
  return (
    <Context.Provider value={canvas}>
      <DesignSpaceProvider
        use={canvas.use}
        open={panel() ? canvas.open : undefined}
        reveal={panel() ? canvas.reveal : undefined}
      >
        {props.children}
      </DesignSpaceProvider>
    </Context.Provider>
  )
}

export function useDesignCanvas() {
  const value = useContext(Context)
  if (!value) throw new Error("DesignCanvas context must be used within a context provider")
  return value
}
