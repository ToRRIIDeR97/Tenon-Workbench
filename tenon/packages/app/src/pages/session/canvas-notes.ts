import { createStore } from "solid-js/store"
import type { PickedDesignElement } from "@tenon/session-ui/design-inspect"

export type CanvasNote = PickedDesignElement & { id: string; number: number; note: string; sent: boolean }

/**
 * Notes left on a canvas design's elements (#326), kept per design version: each new version of a design has its own
 * key, so its pins start empty. Sending marks the pending notes sent and keeps them on the design as a record.
 */
export function canvasNotes() {
  const [state, setState] = createStore<Record<string, CanvasNote[]>>({})
  let next = 0
  const list = (key: string) => state[key] ?? []
  return {
    list,
    pending: (key: string) => list(key).filter((note) => !note.sent),
    /** Adds a note for a picked element; an empty note adds nothing. Returns the note's ID. */
    add(key: string, element: PickedDesignElement, note: string) {
      const text = note.trim()
      if (!text) return undefined
      const id = `note-${++next}`
      const number = (list(key).at(-1)?.number ?? 0) + 1
      setState(key, (notes = []) => [...notes, { ...element, id, number, note: text, sent: false }])
      return id
    },
    remove(key: string, id: string) {
      setState(key, (notes = []) => notes.filter((note) => note.id !== id))
    },
    /** The pending notes, now marked sent. */
    /** The pending notes (or just `only`), now marked sent. */
    send(key: string, only?: string) {
      const sending = list(key).filter((note) => !note.sent && (only === undefined || note.id === only))
      const ids = new Set(sending.map((note) => note.id))
      setState(key, (notes = []) => notes.map((note) => (ids.has(note.id) ? { ...note, sent: true } : note)))
      return sending
    },
  }
}

/** Where a pin sits over the frame: the element's top-right corner, moved by the frame's scroll. */
export function notePosition(note: Pick<CanvasNote, "rect">, scroll: { x: number; y: number }) {
  return { x: note.rect.x + note.rect.width - scroll.x, y: note.rect.y - scroll.y }
}

/** One store for the app session, so notes survive leaving the design and coming back. */
export const canvasNotesStore = canvasNotes()
