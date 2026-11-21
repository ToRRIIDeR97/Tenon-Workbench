import { createEffect, createRoot, createSignal, on, onCleanup, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useDialog } from "@tenon/ui/context/dialog"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import {
  FileReferenceProvider,
  type FileReference,
  type FileReferenceActions,
  type FileReferencePreview,
} from "@tenon/session-ui/context"
import { listedEntryPath, resolveFileReferencePath } from "@tenon/session-ui/markdown-file-reference"
import { mediaKindFromPath } from "@tenon/session-ui/pierre/media"
import { viewerKind } from "@/pages/session/file-viewer"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { SESSION_OPEN_FILE_TAB } from "@/context/layout-tabs"
import { useSessionLayout } from "@/pages/session/session-layout"
import { OutsideFileDialog, outsideFileURL, useOutsideFileReader } from "@/pages/session/outside-file"
import { showToast } from "@/utils/toast"
import { ViewSpaceProvider } from "@tenon/session-ui/context/view"
import { absoluteFrom, useArtifacts } from "@/features/artifacts/artifacts"
import { createViewRenderer } from "@/features/artifacts/view-renderer"

export type FileReveal = { directory: string; path: string; start?: number; end?: number; folder?: boolean }

// The Files view opens its tree sidebar for the newest reveal. A file's viewer scrolls to and marks its
// lines once, then clears it; a folder's tree row is scrolled to, selected and expanded. Module state is
// enough because one session page, and one Files view, is mounted at a time.
const [fileReveal, setFileReveal] = createSignal<FileReveal | undefined>(undefined, { equals: false })
export { fileReveal }
export const clearFileReveal = () => setFileReveal(undefined)

// False while the right panel slides open: its content fades in, and a reveal starts, once it is true.
const [panelSettled, setPanelSettled] = createSignal(true)
export { panelSettled }
let slideTimer: ReturnType<typeof setTimeout> | undefined

/** Called as the right panel starts opening. With reduced motion there is no slide to wait for. */
export function slidePanelOpen() {
  clearTimeout(slideTimer)
  const still = prefersReducedMotion()
  setPanelSettled(still)
  if (still) return
  // The panel and the thread column slide over the medium duration (duration-medium in session.tsx).
  slideTimer = setTimeout(() => setPanelSettled(true), motionDuration("medium"))
}

/**
 * Supplies file-reference actions to assistant replies: the hover peek reads lines through the same
 * file API the Files tab uses, and opening reveals the file or folder in the right panel. Every path is
 * checked against the thread's folder again here. A reference the agent made to a file outside that folder
 * (an absolute path, already normalized) is read through its own folder and opens in a viewer of its own.
 */
export function SessionFileReferences(props: ParentProps) {
  const file = useFile()
  const sdk = useSDK()
  const language = useLanguage()
  const platform = usePlatform()
  const { tabs, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const dialog = useDialog()
  const readOutside = useOutsideFileReader()
  const serverSDK = useServerSDK()
  const listOutside = async (path: string) =>
    (await serverSDK().createClient({ directory: path, throwOnError: true }).file.list({ path: "" })).data ?? []

  const locate = async (reference: FileReference) => {
    const path = resolveFileReferencePath(reference.path, sdk().directory)
    if (!path) return
    // A trailing slash asks for a folder and a file name for a file; an extensionless path takes what is there.
    const type = await entryType(path)
    if (type === "directory" && reference.kind) return { path, folder: true }
    if (type === "file" && reference.kind !== "folder") return { path, folder: false }
    if (reference.kind || path.includes("/")) return
    // A bare name such as `harness.ts` falls back to the file index, but only an unambiguous match counts.
    const matches = await file.searchFiles(path, { limit: 50 })
    const named = [...new Set(matches.filter((item) => item === path || item.endsWith(`/${path}`)))]
    if (named.length === 1) return { path: named[0], folder: false }
  }

  const entryType = async (path: string) => {
    const nodes = await listed(path.split("/").slice(0, -1).join("/"))
    // The server lists folders as `name/`; the tree store lists them without the slash.
    return nodes?.find((node) => listedEntryPath(file.normalize(node.path)) === path)?.type
  }

  // Listed directly so a missing folder stays quiet instead of raising the tree's error toast.
  const listed = (dir: string) => {
    if (file.tree.state(dir)?.loaded) return Promise.resolve(file.tree.children(dir))
    return sdk()
      .client.file.list({ path: dir })
      .then(
        (result) => result.data ?? [],
        () => undefined,
      )
  }

  // Prose such as `and/or` or `owner/repo` rarely starts with a top-level folder, so the root listing,
  // read once per thread folder, screens extensionless paths before their parent folder is listed.
  let rootFolders: { directory: string; names: Promise<Set<string>> } | undefined
  const listedEntry = async (input: string) => {
    const directory = sdk().directory
    const path = resolveFileReferencePath(input, directory)
    if (!path) return
    if (rootFolders?.directory !== directory) {
      const current = {
        directory,
        names: listed("").then((nodes) => {
          if (!nodes && rootFolders === current) rootFolders = undefined
          return new Set(
            (nodes ?? [])
              .filter((node) => node.type === "directory")
              .map((node) => listedEntryPath(file.normalize(node.path))),
          )
        }),
      }
      rootFolders = current
    }
    if (!(await rootFolders.names).has(path.split("/")[0])) return
    return entryType(path)
  }

  const readFileRange = async (reference: FileReference, limit: number): Promise<FileReferencePreview> => {
    if (reference.outside) return readOutsideRange(reference, limit)
    const found = await locate(reference)
    if (!found) return { status: "missing", path: reference.path }
    const path = found.path
    if (found.folder) return { status: "folder", path, count: (await listed(path))?.length ?? 0 }
    const content = file.get(path)?.content ?? (await sdk().client.file.read({ path })).data
    if (!content || content.type === "binary" || content.encoding === "base64") return { status: "binary", path }
    const start = reference.start ?? 1
    const last = reference.start ? Math.min(reference.end ?? start, start + limit - 1) : limit
    return { status: "found", path, start, lines: content.content.split(/\r?\n/).slice(start - 1, last) }
  }

  const readOutsideRange = async (reference: FileReference, limit: number): Promise<FileReferencePreview> => {
    const path = reference.path
    // An outside folder is listed through itself, for the peek's item count; opening it goes to the file manager.
    if (reference.kind === "folder") {
      const entries = await listOutside(path).catch(() => undefined)
      return entries ? { status: "folder", path, count: entries.length } : { status: "missing", path }
    }
    const text = await readOutside(path).catch(() => null)
    if (text === null) return { status: "missing", path }
    if (text === undefined) return { status: "binary", path }
    const start = reference.start ?? 1
    const last = reference.start ? Math.min(reference.end ?? start, start + limit - 1) : limit
    return { status: "found", path, start, lines: text.split(/\r?\n/).slice(start - 1, last) }
  }

  // A text file opens in a read-only viewer; a folder, media or a binary file goes to its default app on desktop.
  const openOutside = async (reference: FileReference) => {
    const external = () => platform.openLocalFile?.(outsideFileURL(reference.path))
    if (reference.kind === "folder" || mediaKindFromPath(reference.path)) return external()
    const text = await readOutside(reference.path).catch(() => null)
    if (text === undefined && platform.openLocalFile) return external()
    dialog.show(() => <OutsideFileDialog reference={reference} />)
  }

  // A file the viewer can't show (a .docx, .xlsx, .zip …) opens in its default app on desktop instead of the
  // panel's "binary file" placeholder. Main still reveals executables rather than running them.
  const opensExternally = async (path: string) => {
    if (!platform.openLocalFile || mediaKindFromPath(path) || viewerKind(path)) return false
    const content = file.get(path)?.content ?? (await sdk().client.file.read({ path })).data
    return content?.type === "binary"
  }
  const openExternally = (directory: string, path: string) => {
    const url = new URL("file:///")
    url.pathname = `${directory.replaceAll("\\", "/").replace(/\/+$/, "")}/${path}`
    platform.openLocalFile?.(url.href)
  }

  const onFileReference = (reference: FileReference) => {
    if (reference.outside) return void openOutside(reference)
    const directory = sdk().directory
    void locate(reference).then(async (found) => {
      if (sdk().directory !== directory) return
      if (!found) {
        showToast({
          variant: "error",
          title: language.t(
            reference.kind === "folder"
              ? "secondBrain.fileReference.folderMissing"
              : "secondBrain.fileReference.missing",
          ),
          description: reference.path,
        })
        return
      }
      const path = found.path
      if (!found.folder && (await opensExternally(path).catch(() => false))) {
        if (sdk().directory === directory) openExternally(directory, path)
        return
      }
      view().reviewPanel.open()
      // Expanding each ancestor lists it, so the tree can find, scroll to and select the row. A folder
      // itself is expanded by the tree once its row is in view.
      const dirs = path.split("/").slice(0, -1)
      dirs.forEach((_, index) => file.tree.expand(dirs.slice(0, index + 1).join("/")))
      if (found.folder) {
        // The tree sits beside any file tab; otherwise the Open file tab shows it.
        const active = tabs().active()
        if (active !== SESSION_OPEN_FILE_TAB && !(active && file.pathFromTab(active))) {
          tabs().previewTab(SESSION_OPEN_FILE_TAB)
          queueMicrotask(() => tabs().setActive(SESSION_OPEN_FILE_TAB))
        }
        setFileReveal({ directory, path, folder: true })
        return
      }
      const tab = file.tab(path)
      tabs().previewTab(tab)
      // As in the side panel: Kobalte can briefly select Review while the preview trigger is replaced.
      queueMicrotask(() => tabs().setActive(tab))
      void file.load(path)
      const start = reference.start
      const end = start && (reference.end ?? start)
      // The viewer selects the lines when it highlights them, so the steady tint arrives with the highlight.
      setFileReveal({ directory, path, start, end })
    })
  }

  // A reveal waits for its view to mount; one that never did must not replay when a later view mounts.
  createEffect(
    on(
      () => view().reviewPanel.opened(),
      (opened) => {
        if (!opened) clearFileReveal()
      },
      { defer: true },
    ),
  )
  onCleanup(clearFileReveal)

  const actions = {
    get directory() {
      return sdk().directory
    },
    readFileRange,
    entryType: listedEntry,
    onFileReference,
  } satisfies FileReferenceActions

  // ```view windows: the agent shows the user a file in the thread; Pin keeps it in the Project's artifacts. A
  // Command Centre thread's files live in the Projects' folders, so a path outside the thread's folder is looked up
  // there and pinned to that Project.
  const artifacts = useArtifacts()
  const locateView = (src: string) => {
    const path = resolveFileReferencePath(src, sdk().directory)
    if (path) return { directory: sdk().directory, path, home: true }
    // `../../projects/Alpha/art/x.png` from a Command Centre thread is the same file as its absolute path.
    const full = absoluteFrom(sdk().directory, src)
    for (const project of artifacts.projects() ?? []) {
      const inside = resolveFileReferencePath(full, project.directory)
      if (inside) return { directory: project.directory, path: inside, home: false }
    }
    return undefined
  }
  const renderView = createViewRenderer({
    locate: locateView,
    fileURL: platform.fileViewerURL ? (directory, path) => platform.fileViewerURL!(directory, path) : undefined,
    read: async (directory, path) =>
      directory === sdk().directory
        ? (file.get(path)?.content ?? (await sdk().client.file.read({ path })).data)
        : (await serverSDK().createClient({ directory, throwOnError: true }).file.read({ path })).data,
    labels: () => ({
      loading: language.t("secondBrain.view.loading"),
      loadFrom: (host) => language.t("secondBrain.view.loadFrom", { host }),
      missing: language.t("secondBrain.view.missing"),
      outside: language.t("secondBrain.view.outside"),
      noPreview: language.t("secondBrain.view.noPreview"),
      modelFailed: language.t("secondBrain.view.modelFailed"),
    }),
  })

  // The right panel only exists on desktop widths; elsewhere references stay plain code.
  return (
    <ViewSpaceProvider
      render={renderView}
      available={(item) => locateView(item.src) !== undefined}
      open={(item) => {
        const found = locateView(item.src)
        if (!found) return
        // A file in another Project opens as a file outside this thread's folder.
        if (found.home) return onFileReference({ path: found.path })
        onFileReference({
          path: `${found.directory.replaceAll("\\", "/").replace(/\/+$/, "")}/${found.path}`,
          outside: true,
        })
      }}
      pin={(item) => {
        const found = locateView(item.src)
        if (found) artifacts.toggle(found.directory, { ...item, src: found.path })
      }}
      pinned={(item) => {
        const found = locateView(item.src)
        return !!found && artifacts.has(found.directory, found.path)
      }}
      watchPinned={(item, change) =>
        createRoot((dispose) => {
          createEffect(
            on(
              () => {
                const found = locateView(item.src)
                return !!found && artifacts.has(found.directory, found.path)
              },
              change,
              { defer: true },
            ),
          )
          return dispose
        })
      }
    >
      <FileReferenceProvider value={() => (isDesktop() ? actions : undefined)}>{props.children}</FileReferenceProvider>
    </ViewSpaceProvider>
  )
}
