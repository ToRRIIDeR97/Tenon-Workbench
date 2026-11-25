import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { Portal } from "solid-js/web"
import { prefersReducedMotion } from "@tenon/ui/v2/motion"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { changedBlocks, liveWrites, markdownBlocks, type LiveWrite } from "@/pages/session/live-document"

const FLASH_MS = 1600

export function createSessionWrites() {
  const sync = useSync()
  const layout = useSessionLayout()
  return createMemo(() => {
    const id = layout.params.id
    if (!id) return []
    return (sync().data.message[id] ?? [])
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        liveWrites(sync().data.part[message.id] ?? []).map((write) => ({
          ...write,
          created: message.time.created,
          ongoing: message.role === "assistant" && !message.time.completed && !message.error,
        })),
      )
  })
}

export function createViewNewest() {
  const sync = useSync()
  const layout = useSessionLayout()
  const [newest, setNewest] = createSignal<{ id: string; time: number }>()
  createEffect(() => {
    const id = layout.params.id
    if (!id || untrack(newest)?.id === id) return
    const messages = sync().data.message[id] ?? []
    if (messages.length === 0) return
    setNewest({ id, time: Math.max(...messages.map((message) => message.time.created)) })
  })
  return () => {
    const known = newest()
    return known && known.id === layout.params.id ? known.time : undefined
  }
}

export const isWriting = (write: LiveWrite | undefined) => write?.status === "streaming" || write?.status === "running"
const isDesign = (path: string) => /\.html?$/i.test(path)

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
        if (!path || path.split(/[\\/]/).includes("..")) return
        opened.add(write.callID)
        untrack(() => {
          view().reviewPanel.open()
          const tab = file.tab(path)
          tabs().previewTab(tab)
          queueMicrotask(() => tabs().setActive(tab))
          void file.load(path)
        })
      })
  })
}

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

export function LiveDocumentTail() {
  return (
    <div aria-hidden="true" data-slot="live-document-tail" class="flex flex-col gap-2 pt-1">
      <span data-slot="live-document-caret" class="inline-block h-[1.1em] w-0.5 bg-v2-background-bg-accent" />
      <span class="h-2.5 w-2/3 rounded-full bg-v2-background-bg-layer-01 animate-pulse motion-reduce:animate-none" />
    </div>
  )
}

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
  const [host, setHost] = createSignal<HTMLElement>()
  onMount(() => {
    const el = viewport()
    if (!el) return
    setHost(el.closest<HTMLElement>(".scroll-view") ?? undefined)
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
    <Show when={host()}>
      {(mount) => (
        <Portal mount={mount()}>
          <div class="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
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
              {following()
                ? language.t("secondBrain.liveDocument.following")
                : language.t("secondBrain.liveDocument.jump")}
            </button>
          </div>
        </Portal>
      )}
    </Show>
  )
}

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

export function blockOwners(texts: readonly string[], markdown: string): number[] {
  const blocks = markdownBlocks(markdown).map(plain)
  const walk = { block: 0, used: 0 }
  const take = (block: number, used: number) => {
    walk.block = used >= (blocks[block]?.length ?? 0) ? block + 1 : block
    walk.used = used >= (blocks[block]?.length ?? 0) ? 0 : used
    return block
  }
  return texts.map((raw) => {
    const text = plain(raw)
    const current = blocks[walk.block]
    if (current !== undefined && text && current.startsWith(text, walk.used))
      return take(walk.block, walk.used + text.length)
    const from = walk.used ? walk.block + 1 : walk.block
    const later = (match: (source: string) => boolean) =>
      blocks.findIndex((source, index) => index >= from && match(source))
    const equal = later((source) => source === text)
    if (equal !== -1) return take(equal, text.length)
    const starts = later((source) => source.startsWith(text))
    if (starts !== -1) return take(starts, text.length)
    const inside = later((source) => source.includes(text))
    if (inside !== -1) return take(inside, (blocks[inside]?.indexOf(text) ?? 0) + text.length)
    return Math.min(walk.block, Math.max(0, blocks.length - 1))
  })
}

export function flashChangedBlocks(root: HTMLElement, before: string, after: string) {
  const changed = new Set(changedBlocks(before, after))
  const viewport = root.closest<HTMLElement>("[data-scrollable]")
  const elements = () =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-markdown-block] > *")).filter((el) =>
      plain(el.textContent ?? ""),
    )
  const top = viewport?.getBoundingClientRect().top ?? 0
  const anchor = elements().find((el) => el.getBoundingClientRect().bottom > top)
  const held =
    anchor && viewport
      ? {
          text: plain(anchor.textContent ?? ""),
          offset: anchor.getBoundingClientRect().top - top,
          position: anchor.getBoundingClientRect().top - top + viewport.scrollTop,
        }
      : undefined
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--v2-background-bg-accent-container")
    .trim()
  const animated = new WeakSet<HTMLElement>()
  const state = { applied: false, scroll: undefined as number | undefined }
  const apply = () => {
    clearTimeout(fallback)
    if (!state.applied) {
      state.applied = true
      setTimeout(() => stop(), FLASH_MS)
    }
    const list = elements()
    const owners = blockOwners(
      list.map((el) => el.textContent ?? ""),
      after,
    )
    if (held && viewport && (state.scroll === undefined || state.scroll === viewport.scrollTop)) {
      const offset = (el: HTMLElement) =>
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      const same = list
        .filter((el) => plain(el.textContent ?? "") === held.text)
        .sort((a, b) => Math.abs(offset(a) - held.position) - Math.abs(offset(b) - held.position))[0]
      if (same)
        viewport.scrollTop += same.getBoundingClientRect().top - viewport.getBoundingClientRect().top - held.offset
      state.scroll = viewport.scrollTop
    }
    list.forEach((el, index) => {
      if (!changed.has(owners[index] ?? -1)) {
        delete el.dataset.liveFlash
        return
      }
      el.dataset.liveFlash = ""
      if (animated.has(el) || prefersReducedMotion() || !accent) return
      animated.add(el)
      el.animate([{ backgroundColor: accent }, { backgroundColor: "transparent" }], {
        duration: FLASH_MS,
        easing: "ease-out",
      })
    })
  }
  flashing.get(root)?.()
  root.querySelectorAll<HTMLElement>("[data-live-flash]").forEach((el) => delete el.dataset.liveFlash)
  const frame = { id: 0 }
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame.id)
    frame.id = requestAnimationFrame(apply)
  })
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  const fallback = setTimeout(apply, 1000)
  const stop = () => {
    observer.disconnect()
    clearTimeout(fallback)
    cancelAnimationFrame(frame.id)
    if (flashing.get(root) === stop) flashing.delete(root)
  }
  flashing.set(root, stop)
}

const flashing = new WeakMap<HTMLElement, () => void>()
