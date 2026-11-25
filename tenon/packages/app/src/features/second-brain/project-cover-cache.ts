import { createResource, createSignal } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { prefersReducedMotion } from "@tenon/ui/v2/motion"
import { readProjectCover, type ProjectRecord } from "./client"

const COVER_CACHE_LIMIT = 24
const covers = new Map<string, Promise<string | undefined>>()

export function coverKey(directory: string, project: Pick<ProjectRecord, "id" | "cover">) {
  return project.cover && directory ? `${directory}\n${project.id}\n${project.cover}` : undefined
}

export function cachedCover(key: string, load: () => Promise<string | undefined>) {
  const hit = covers.get(key)
  if (hit) {
    covers.delete(key)
    covers.set(key, hit)
    return hit
  }
  const pending = load().catch(() => {
    covers.delete(key)
    return undefined
  })
  remember(key, pending)
  return pending
}

export function storeCover(key: string | undefined, dataUrl: string) {
  if (key) remember(key, Promise.resolve(dataUrl))
}

function remember(key: string, value: Promise<string | undefined>) {
  covers.set(key, value)
  for (const stale of covers.keys()) {
    if (covers.size <= COVER_CACHE_LIMIT) break
    covers.delete(stale)
  }
}

export function useProjectCoverImage(directory: () => string, project: () => ProjectRecord) {
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [image, actions] = createResource(
    () => coverKey(directory(), project()),
    (key) =>
      cachedCover(key, () =>
        readProjectCover(
          { server: serverSDK().server, fetch: platform.fetch, target: { directory: directory() } },
          project().id,
        ).then((result) => result.dataUrl ?? undefined),
      ),
  )
  return {
    image: () => (coverKey(directory(), project()) ? image.latest : undefined),
    saved: (record: ProjectRecord, dataUrl: string) => {
      storeCover(coverKey(directory(), record), dataUrl)
      actions.mutate(dataUrl)
    },
    removed: () => actions.mutate(undefined),
  }
}

export const PROJECT_COVER_MORPH = "project-cover"
const [morphing, setMorphing] = createSignal<string>()
export const coverMorphing = morphing

const MORPH_START_MS = 250
const MORPH_SETTLE_MS = 32

type CoverTransition = { finished: Promise<void>; skipTransition?: () => void }

export function morphCover(projectId: string, change: () => void) {
  const start = (document as Document & { startViewTransition?: (update: () => Promise<void>) => CoverTransition })
    .startViewTransition
  if (!start || prefersReducedMotion()) return change()
  const once = { done: false }
  const apply = () => {
    if (once.done) return
    once.done = true
    change()
  }
  setMorphing(projectId)
  const transition = start.call(document, async () => {
    apply()
    await new Promise<void>((resolve) => setTimeout(resolve, MORPH_SETTLE_MS))
  })
  const fallback = setTimeout(() => {
    if (once.done) return
    transition.skipTransition?.()
    apply()
  }, MORPH_START_MS)
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(fallback)
      setMorphing(undefined)
    })
}
