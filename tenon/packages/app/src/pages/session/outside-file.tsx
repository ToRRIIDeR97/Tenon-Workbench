import { createResource, For, Match, Show, Switch } from "solid-js"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import type { FileReference } from "@tenon/session-ui/context"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"

/**
 * A file an agent cited outside the thread's folder: its own folder (the parent of the cited path) and its name
 * there. The server reads it through that folder like any other, so the path stays a plain relative name.
 */
export function outsideFileLocation(path: string) {
  const cut = path.lastIndexOf("/")
  const folder = path.slice(0, cut)
  return { folder: !folder ? "/" : /^[A-Za-z]:$/.test(folder) ? `${folder}/` : folder, name: path.slice(cut + 1) }
}

/** A `file://` URL for an absolute path with forward slashes (`C:/x/y.md` or `/x/y.md`). */
export function outsideFileURL(path: string) {
  const url = new URL("file:///")
  url.pathname = path
  return url.href
}

/** Reads an outside file's text through its own folder; undefined for a binary file. */
export function useOutsideFileReader() {
  const serverSDK = useServerSDK()
  return async (path: string) => {
    const location = outsideFileLocation(path)
    const client = serverSDK().createClient({ directory: location.folder, throwOnError: true })
    const content = (await client.file.read({ path: location.name })).data
    if (!content || content.type === "binary" || content.encoding === "base64") return
    return content.content
  }
}

/**
 * Shows a file outside the thread's folder, read-only, with its cited lines marked. The Files panel only knows the
 * thread's folder, so the file gets a viewer of its own; on desktop it can also go to its default app.
 */
export function OutsideFileDialog(props: { reference: FileReference }) {
  const language = useLanguage()
  const platform = usePlatform()
  const read = useOutsideFileReader()
  const [text] = createResource(
    () => props.reference.path,
    (path) => read(path).catch(() => null),
  )
  const lines = () => text()?.split(/\r?\n/) ?? []
  const marked = (line: number) =>
    !!props.reference.start && line >= props.reference.start && line <= (props.reference.end ?? props.reference.start)
  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitle>
          <span class="block truncate">{outsideFileLocation(props.reference.path).name}</span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="min-h-0 gap-3 px-4 pb-4">
        <div class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate type-meta text-v2-text-text-muted" title={props.reference.path}>
            {props.reference.path}
          </span>
          <Show when={platform.openLocalFile}>
            <ButtonV2
              size="small"
              variant="ghost"
              icon="outline-square-arrow"
              onClick={() => platform.openLocalFile?.(outsideFileURL(props.reference.path))}
            >
              {language.t("secondBrain.fileReference.openDefaultApp")}
            </ButtonV2>
          </Show>
        </div>
        <div
          data-component="outside-file-view"
          class="max-h-[min(calc(100vh-220px),640px)] min-h-24 overflow-auto rounded-[16px] bg-v2-background-bg-layer-01 py-3 font-mono text-[12px] leading-5 text-v2-text-text-base"
        >
          <Switch>
            <Match when={text.loading}>
              <div role="status" class="px-4 text-v2-text-text-muted">
                {language.t("common.loading")}
                {language.t("common.loading.ellipsis")}
              </div>
            </Match>
            <Match when={text() === null}>
              <div class="px-4 text-v2-text-text-muted">{language.t("secondBrain.fileReference.missingOutside")}</div>
            </Match>
            <Match when={text() === undefined}>
              <div class="px-4 text-v2-text-text-muted">{language.t("session.files.binaryContent")}</div>
            </Match>
            <Match when={true}>
              <For each={lines()}>
                {(line, index) => (
                  <div
                    class="flex min-w-max gap-4 px-4"
                    classList={{ "bg-v2-overlay-simple-overlay-hover": marked(index() + 1) }}
                    ref={(el) => {
                      // The first cited line is scrolled into view once it renders.
                      if (index() + 1 === props.reference.start)
                        queueMicrotask(() => el.scrollIntoView({ block: "center" }))
                    }}
                  >
                    <span class="w-10 shrink-0 select-none text-right tabular-nums text-v2-text-text-faint">
                      {index() + 1}
                    </span>
                    <span class="whitespace-pre">{line}</span>
                  </div>
                )}
              </For>
            </Match>
          </Switch>
        </div>
      </DialogBody>
    </Dialog>
  )
}
