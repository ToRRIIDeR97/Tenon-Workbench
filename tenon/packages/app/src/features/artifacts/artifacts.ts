import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import { viewKind, type ViewItem, type ViewKind } from "@tenon/session-ui/view-window"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useLayout } from "@/context/layout"
import { useProjectThreads } from "@/components/sidebar/sidebar-controller"
import { listVaultPages, readVaultPage, writeVaultPage } from "@/features/second-brain/client"
import { Persist, persisted } from "@/utils/persist"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

/** A file the user pinned to a Project: what the agent showed them and they want to keep reviewing. */
export type Artifact = {
  /** Relative to the Project's thread folder, with `/`. */
  path: string
  name: string
  kind: ViewKind
  pinnedAt: number
}

/** A Project as the artifacts see it: where its threads run. */
export type ArtifactProject = { id: string; name: string; directory: string }

/** The vault page that holds a Project's artifacts; agents read it with notes_read. */
export const ARTIFACTS_PAGE = "Artifacts.md"
const PAGE_MARK = "artifacts"

/** Folder keys match however the path was written: separators, trailing slashes and (Windows) letter case. */
export function folderKey(directory: string) {
  const path = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  return /^[a-z]:\//i.test(path) ? path.toLowerCase() : path
}

/** The Project whose thread folder holds `directory` (the folder itself or one inside it, such as a worktree). */
export function projectFor(projects: ReadonlyArray<ArtifactProject> | undefined, directory: string) {
  const key = folderKey(directory)
  return projects
    ?.filter((project) => {
      const root = folderKey(project.directory)
      return key === root || key.startsWith(`${root}/`)
    })
    .toSorted((left, right) => right.directory.length - left.directory.length)[0]
}

/**
 * `path` (relative to `from`) relative to `to` instead, when it lies inside `to`. Case is compared the way folder keys
 * are, but the original spelling is kept.
 */
export function rebase(from: string, path: string, to: string) {
  const full = `${from.replaceAll("\\", "/").replace(/\/+$/, "")}/${path.replaceAll("\\", "/")}`
  const root = to.replaceAll("\\", "/").replace(/\/+$/, "")
  return folderKey(full).startsWith(`${folderKey(root)}/`) ? full.slice(root.length + 1) : path
}

/** `src` as an absolute path with `/`: kept when already absolute, else resolved against `directory` (`..` included). */
export function absoluteFrom(directory: string, src: string) {
  const path = src.replaceAll("\\", "/")
  if (/^([a-z]:)?\//i.test(path)) return path
  const parts = `${directory.replaceAll("\\", "/").replace(/\/+$/, "")}/${path}`.split("/")
  return parts
    .reduce<string[]>((kept, part, index) => {
      if (part === "..") return kept.length > 1 ? kept.slice(0, -1) : kept
      if (part === "." || (part === "" && index > 0)) return kept
      return [...kept, part]
    }, [])
    .join("/")
}

/** Pins `item` when it isn't pinned, else unpins it; newest first. */
export function togglePinned(list: readonly Artifact[], item: Pick<ViewItem, "src" | "name" | "kind">, now: number) {
  if (list.some((artifact) => artifact.path === item.src)) return list.filter((artifact) => artifact.path !== item.src)
  return [{ path: item.src, name: item.name, kind: item.kind, pinnedAt: now }, ...list]
}

/** The page body: a list people and agents can read. The list itself is kept in the page's properties. */
export function artifactsPage(items: readonly Artifact[]) {
  return [
    "# Artifacts",
    "",
    "Files pinned to this Project for review in Tenon. Paths are relative to the Project's folder; open one with a ```view block.",
    "",
    ...(items.length > 0 ? items.map((item) => `- ${item.name} — \`${item.path}\``) : ["Nothing is pinned yet."]),
    "",
  ].join("\n")
}

/**
 * Artifacts from a page's properties. Page properties hold only scalars and lists of them, so the page keeps the
 * paths, newest first, and each file's name and viewer come from its path. Anything that isn't a path is dropped.
 */
export function readArtifacts(properties: Record<string, unknown> | undefined): Artifact[] {
  const list = properties?.[PAGE_MARK]
  if (!Array.isArray(list)) return []
  return list.flatMap((value) => (typeof value === "string" && value.trim() ? [artifactAt(value)] : []))
}

/** The artifact for a path relative to its Project's folder. */
export function artifactAt(path: string, pinnedAt = 0): Artifact {
  return { path, name: path.split("/").filter(Boolean).pop() ?? path, kind: viewKind(path), pinnedAt }
}

/** At most this many pins per Project: a page property list holds 100. */
export const MAX_ARTIFACTS = 100

type ProjectEntry = { items: Artifact[]; path?: string; revision?: string; loaded: boolean }

/**
 * A Project's artifacts live on its vault page, so they follow the vault to other machines and agents can read them.
 * A folder outside every Project keeps its list on this machine.
 */
export function createArtifacts() {
  const platform = usePlatform()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const layout = useLayout()
  const threads = useProjectThreads()
  const [local, setLocal] = persisted(
    Persist.global("artifacts.v1"),
    createStore<{ byFolder: Record<string, Artifact[]> }>({ byFolder: {} }),
  )
  const [vault, setVault] = createStore<Record<string, ProjectEntry>>({})
  const loading = new Map<string, Promise<void>>()

  const projects = (): ArtifactProject[] | undefined =>
    threads.isPending || threads.isError
      ? undefined
      : threads.data?.map((entry) => ({
          id: entry.project.id,
          name: entry.project.name,
          directory: entry.threadDirectory,
        }))
  const client = () => {
    const directory = layout.home.workspace()
    return directory ? { server: serverSDK().server, fetch: platform.fetch, target: { directory } } : undefined
  }

  const load = (projectID: string) => {
    const current = loading.get(projectID)
    if (current) return current
    const api = client()
    if (!api) return Promise.resolve()
    const run = listVaultPages(api, { project: projectID })
      .then(async (pages) => {
        const page = pages.find((item) => item.properties?.tenon === PAGE_MARK)
        if (!page) return setVault(projectID, { items: [], loaded: true })
        const read = await readVaultPage(api, page.path)
        setVault(projectID, {
          items: readArtifacts(read.info.properties),
          path: read.info.path,
          revision: read.revision,
          loaded: true,
        })
      })
      .catch(() => setVault(projectID, (entry) => ({ items: entry?.items ?? [], loaded: true })))
      .finally(() => loading.delete(projectID))
    loading.set(projectID, run)
    return run
  }

  // Writes the whole list; a page changed elsewhere meanwhile is read again and the change applied to it once more.
  const save = async (projectID: string, change: (items: readonly Artifact[]) => Artifact[], retry = true) => {
    const api = client()
    if (!api) return
    // A loaded list changes at once, so the Pin button reads its new state right after the click.
    if (!vault[projectID]?.loaded) await load(projectID)
    const entry = vault[projectID]
    const items = change(entry?.items ?? []).slice(0, MAX_ARTIFACTS)
    setVault(projectID, (current) => ({ ...current, items, loaded: true }))
    try {
      const written = await writeVaultPage(api, {
        path: entry?.path ?? ARTIFACTS_PAGE,
        ...(entry?.path ? {} : { projectId: projectID, create: true }),
        title: "Artifacts",
        body: artifactsPage(items),
        properties: { tenon: PAGE_MARK, [PAGE_MARK]: items.map((item) => item.path) },
        ...(entry?.revision ? { expectedRevision: entry.revision } : {}),
      })
      setVault(projectID, { items, path: written.info.path, revision: written.revision, loaded: true })
    } catch (error) {
      setVault(projectID, { items: entry?.items ?? [], path: entry?.path, revision: entry?.revision, loaded: true })
      if (!retry)
        return showToast({
          variant: "error",
          title: language.t("secondBrain.artifacts.saveFailed"),
          description: error instanceof Error ? error.message : undefined,
        })
      loading.delete(projectID)
      setVault(projectID, (current) => ({ ...current, loaded: false }))
      await load(projectID)
      await save(projectID, change, false)
    }
  }

  // Paths are kept relative to the Project's folder, so a thread in a worktree or subfolder agrees with the rest.
  const inProject = (directory: string, path: string) => {
    const project = projectFor(projects(), directory)
    return { project, path: project ? rebase(directory, path, project.directory) : path }
  }

  const list = (directory: string): Artifact[] => {
    const project = projectFor(projects(), directory)
    if (!project) return local.byFolder[folderKey(directory)] ?? []
    const entry = vault[project.id]
    if (!entry?.loaded) void load(project.id)
    return entry?.items ?? []
  }

  return {
    projects,
    projectFor: (directory: string) => projectFor(projects(), directory),
    /** The folder a list's paths are relative to: the Project's, else the folder itself. */
    base: (directory: string) => projectFor(projects(), directory)?.directory ?? directory,
    list,
    has: (directory: string, path: string) =>
      list(directory).some((artifact) => artifact.path === inProject(directory, path).path),
    toggle(directory: string, item: Pick<ViewItem, "src" | "name" | "kind">) {
      const placed = inProject(directory, item.src)
      if (placed.project)
        return void save(placed.project.id, (items) => togglePinned(items, { ...item, src: placed.path }, Date.now()))
      setLocal("byFolder", folderKey(directory), togglePinned(list(directory), item, Date.now()))
    },
    remove(directory: string, path: string) {
      const project = projectFor(projects(), directory)
      if (project) return void save(project.id, (items) => items.filter((artifact) => artifact.path !== path))
      setLocal(
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
  // context (the platform's storage, the server, the workspace). A callback that takes `dispose` makes an owned root:
  // one without it gets no context at all.
  shared ??= createRoot((_dispose) => createArtifacts(), getOwner())
  return shared
}
