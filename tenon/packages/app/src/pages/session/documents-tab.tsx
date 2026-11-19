import { For, Show, createMemo } from "solid-js"
import { useFileReferences } from "@tenon/session-ui/context"
import { Icon } from "@tenon/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { threadDocuments } from "@/pages/session/documents"
import { LiveDocumentChip } from "@/pages/session/live-document-view"
import { useSessionLayout } from "@/pages/session/session-layout"

/**
 * The Documents section: what this thread's agent wrote or linked, each opening rendered in the Files viewer (or,
 * outside the thread's folder, the read-only viewer) through the same path as a file link in the thread.
 */
export function SessionDocumentsTab() {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const layout = useSessionLayout()
  const references = useFileReferences()
  const documents = createMemo(() => {
    const id = layout.params.id
    if (!id) return []
    return threadDocuments(
      (sync().data.message[id] ?? [])
        .filter((message) => message.role === "assistant")
        .map((message) => ({ created: message.time.created, parts: sync().data.part[message.id] ?? [] })),
      sdk().directory,
    )
  })
  const name = (path: string) => path.split("/").at(-1) ?? path
  const folder = (path: string) => path.split("/").slice(0, -1).join("/")

  return (
    <Show
      when={documents().length > 0}
      fallback={
        <div class="h-full px-6 pb-42 flex items-center justify-center text-center">
          <div class="max-w-56 text-[13px] leading-5 text-v2-text-text-muted">
            {language.t("secondBrain.documents.empty")}
          </div>
        </div>
      }
    >
      <div class="h-full overflow-y-auto px-2 py-2" data-scrollable>
        <ul class="m-0 flex list-none flex-col gap-0.5 p-0" aria-label={language.t("secondBrain.documents.title")}>
          <For each={documents()}>
            {(document) => (
              <li>
                <button
                  type="button"
                  data-action="documents-open"
                  disabled={!references()}
                  title={document.path}
                  class="flex w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-short ease-standard enabled:hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus"
                  onClick={() =>
                    references()?.onFileReference({
                      path: document.path,
                      ...(document.outside ? { outside: true } : {}),
                    })
                  }
                >
                  <Icon name="document" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-[13px] leading-[18px] text-v2-text-text-base">
                      {name(document.path)}
                    </span>
                    <span class="truncate type-meta text-v2-text-text-muted">
                      {[
                        folder(document.path),
                        language.t(document.wrote ? "secondBrain.documents.wrote" : "secondBrain.documents.linked"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Show when={document.writing}>
                    <LiveDocumentChip writing />
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )
}
