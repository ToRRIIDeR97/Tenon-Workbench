import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { prefersReducedMotion } from "@tenon/ui/v2/motion"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { changedBlocks, liveWrites, markdownBlocks, type LiveWrite } from "@/pages/session/live-document"

// The changed-block flash in the file pane (Claude's file pane uses the same length).
const FLASH_MS = 1600

/** The current thread's `write` and `edit` calls, from the healed tool input in the session parts. */
export function createSessionWrites() {
  const sync = useSync()
  const layout = useSessionLayout()
  return createMemo(() => {
    const id = layout.params.id
    if (!id) return []
    return (sync().data.message[id] ?? [])
      .filter((message) => message.role === "assistant")
      .flatMap((message) => liveWrites(sync().data.part[message.id] ?? []))
  })
}

export const isWriting = (write: LiveWrite | undefined) => write?.status === "streaming" || write?.status === "running"
const isDesign = (path: string) => /\.html?$/i.test(path)

/**
 * Opens the side panel on Files with the file the agent starts writing or editing. Only a call whose
 * input grew while this view watched counts (history never opens the panel), each call opens at most
 * once, and `.html` writes are Canvas designs instead.
 */
export function createLiveDocumentOpener(enabled: () => boolean) {
  const file = useFile()
  const { tabs, view } = useSessionLayout()
  const writes = createSessionWrites()
  const first = new Map<string, string>()
  const opened = new Set<string>()
  createEffect(() => {
    writes()
      .filter((write) => isWriting(write) && !isDesign(write.path))
      .forEach((write) => {
        const text = write.content ?? write.newString ?? ""
        const seen = first.get(write.callID)
        if (seen === undefined) {
          first.set(write.callID, text)
          return
        }
        if (opened.has(write.callID) || seen === text || !untrack(enabled)) return
        const path = file.normalize(write.path)
        // Tool input is untrusted: only plain paths inside the workspace open.
        if (!path || path.split(/[\\/]/).includes("..")) return
        opened.add(write.callID)
        untrack(() => {
          view().reviewPanel.open()
          const tab = file.tab(path)
          tabs().previewTab(tab)
          // As in the side panel: Kobalte can briefly select Review while the preview trigger is replaced.
          queueMicrotask(() => tabs().setActive(tab))
          void file.load(path)
        })
      })
  })
}

/** "Tenon is writing" with the live dot, then "Saved just now". */
export function LiveDocumentChip(props: { writing: boolean }) {
  const language = useLanguage()
  return (
    <span
      data-slot="live-document-status"
      class="flex shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-01 px-2 py-0.5 text-[12px] text-v2-text-text-muted"
    >
      <Show when={props.writing}>
        <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse" />
      </Show>
      {props.writing ? language.t("secondBrain.liveDocument.writing") : language.t("secondBrain.liveDocument.saved")}
    </span>
  )
}

/** The caret at the end of the live text and the shimmer line where the next block will appear. */
export function LiveDocumentTail() {
  return (
    <div aria-hidden="true" data-slot="live-document-tail" class="flex flex-col gap-2 pt-1">
      <span data-slot="live-document-caret" class="inline-block h-[1.1em] w-0.5 bg-v2-background-bg-accent" />
      <span class="h-2.5 w-2/3 rounded-full bg-v2-background-bg-layer-01 animate-pulse motion-reduce:animate-none" />
    </div>
  )
}

/**
 * Keeps the end of the live text in view while Tenon writes, until the reader scrolls; the pill then
 * reads "Jump to Tenon" and brings the caret back. `anchor` is any element inside the scroll viewport.
 */
export function LiveDocumentFollow(props: { text: string; anchor: () => HTMLElement | undefined }) {
  const language = useLanguage()
  const [following, setFollowing] = createSignal(true)
  const viewport = () => props.anchor()?.closest<HTMLElement>("[data-scrollable]") ?? undefined
  const toEnd = () => {
    const el = viewport()
    if (el) el.scrollTop = el.scrollHeight
  }
  createEffect(() => {
    void props.text
    if (following()) queueMicrotask(toEnd)
  })
  onMount(() => {
    const el = viewport()
    if (!el) return
    const stop = () => setFollowing(false)
    el.addEventListener("wheel", stop, { passive: true })
    el.addEventListener("pointerdown", stop)
    el.addEventListener("keydown", stop)
    onCleanup(() => {
      el.removeEventListener("wheel", stop)
      el.removeEventListener("pointerdown", stop)
      el.removeEventListener("keydown", stop)
    })
  })
  return (
    <div class="pointer-events-none sticky bottom-4 flex justify-center">
      <button
        type="button"
        data-slot="live-document-follow"
        data-following={following() ? "" : undefined}
        class="pointer-events-auto h-7 rounded-full bg-v2-background-bg-base px-3 type-control text-v2-text-text-base shadow-[0_0_0_1px_var(--v2-border-border-muted),var(--v2-elevation-floating)] outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setFollowing(true)
          toEnd()
        }}
      >
        {following() ? language.t("secondBrain.liveDocument.following") : language.t("secondBrain.liveDocument.jump")}
      </button>
    </div>
  )
}

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

/**
 * After the rendered Markdown under `root` changes from `before` to `after`: flash the rendered elements
 * of the changed blocks once and keep the block the reader is on where it was. Rendered elements are
 * matched to source blocks by their text, in order, because the renderer's blocks differ from
 * `markdownBlocks`. Call it before the new text renders; it waits for the render.
 */
export function flashChangedBlocks(root: HTMLElement, before: string, after: string) {
  const changed = new Set(changedBlocks(before, after))
  const viewport = root.closest<HTMLElement>("[data-scrollable]")
  const elements = () =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-markdown-block] > *")).filter((el) =>
      plain(el.textContent ?? ""),
    )
  // The reader's anchor: the first element whose bottom is below the viewport's top.
  const top = viewport?.getBoundingClientRect().top ?? 0
  const anchor = elements().find((el) => el.getBoundingClientRect().bottom > top)
  const held = anchor
    ? { text: plain(anchor.textContent ?? ""), offset: anchor.getBoundingClientRect().top - top }
    : undefined
  const state = { done: false }
  const apply = () => {
    if (state.done) return
    state.done = true
    observer.disconnect()
    clearTimeout(fallback)
    const blocks = markdownBlocks(after).map(plain)
    const list = elements()
    // Walk the rendered elements in order, moving to the next source block when one isn't in it.
    const owners = list.reduce<{ block: number; owners: number[] }>(
      (walk, el) => {
        const text = plain(el.textContent ?? "")
        const block = blocks.findIndex((source, index) => index >= walk.block && source.includes(text))
        const owner = block === -1 ? walk.block : block
        return { block: owner, owners: [...walk.owners, owner] }
      },
      { block: 0, owners: [] },
    ).owners
    if (held && viewport) {
      const same = list.find((el) => plain(el.textContent ?? "") === held.text)
      if (same)
        viewport.scrollTop += same.getBoundingClientRect().top - viewport.getBoundingClientRect().top - held.offset
    }
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--v2-background-bg-accent-container")
      .trim()
    list
      .filter((_, index) => changed.has(owners[index] ?? -1))
      .forEach((el) => {
        el.dataset.liveFlash = ""
        if (prefersReducedMotion() || !accent) return
        el.animate([{ backgroundColor: accent }, { backgroundColor: "transparent" }], {
          duration: FLASH_MS,
          easing: "ease-out",
        })
      })
  }
  root.querySelectorAll<HTMLElement>("[data-live-flash]").forEach((el) => delete el.dataset.liveFlash)
  // The renderer updates asynchronously; apply once its DOM changes (or soon, if nothing changes).
  const observer = new MutationObserver(() => requestAnimationFrame(apply))
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  const fallback = setTimeout(apply, 1000)
}
