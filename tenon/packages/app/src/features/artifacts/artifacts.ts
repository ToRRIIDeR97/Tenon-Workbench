import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { ViewItem, ViewKind } from "@tenon/session-ui/view-window"
import { Persist, persisted } from "@/utils/persist"

/** A file the user pinned to a Project: what the agent showed them and they want to keep reviewing. */
export type Artifact = {
  /** Relative to the Project's thread folder. */
  path: string
  name: string
  kind: ViewKind
  pinnedAt: number
}

type State = { byFolder: Record<string, Artifact[]> }

/** Folder keys match however the path was written: separators, trailing slashes and (Windows) letter case. */
export function folderKey(directory: string) {
  const path = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  return /^[a-z]:\//i.test(path) ? path.toLowerCase() : path
}

/** Pins `item` when it isn't pinned, else unpins it; newest first. */
export function togglePinned(list: readonly Artifact[], item: Pick<ViewItem, "src" | "name" | "kind">, now: number) {
  if (list.some((artifact) => artifact.path === item.src)) return list.filter((artifact) => artifact.path !== item.src)
  return [{ path: item.src, name: item.name, kind: item.kind, pinnedAt: now }, ...list]
}

/**
 * A Project's artifacts, kept on this machine per thread folder. Every thread in the Project, and the Canvas tab,
 * reads the same list.
 */
export function createArtifacts() {
  const [state, setState] = persisted(Persist.global("artifacts.v1"), createStore<State>({ byFolder: {} }))
  const list = (directory: string) => state.byFolder[folderKey(directory)] ?? []
  return {
    list,
    has: (directory: string, path: string) => list(directory).some((artifact) => artifact.path === path),
    toggle(directory: string, item: Pick<ViewItem, "src" | "name" | "kind">) {
      setState("byFolder", folderKey(directory), togglePinned(list(directory), item, Date.now()))
    },
    remove(directory: string, path: string) {
      setState(
        "byFolder",
        folderKey(directory),
        list(directory).filter((artifact) => artifact.path !== path),
      )
    },
  }
}

let shared: ReturnType<typeof createArtifacts> | undefined
/** One list for the app, so a pin in the thread shows at once in the Documents section and the Canvas tab. */
export function useArtifacts() {
  // Its own root, so the store outlives the view that first asked for it; that view's owner still lends it the app's
  // context (the platform's storage).
  // A callback that takes `dispose` makes an owned root: one without it gets no context at all.
  shared ??= createRoot((_dispose) => createArtifacts(), getOwner())
  return shared
}
