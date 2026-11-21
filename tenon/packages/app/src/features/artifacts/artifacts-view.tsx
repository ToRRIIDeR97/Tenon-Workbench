import { For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useFileReferences } from "@tenon/session-ui/context"
import { useViewSpace } from "@tenon/session-ui/context/view"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { submitComposer } from "@/components/prompt-input/reply-bridge"
import { useArtifacts, type Artifact } from "./artifacts"

const rowClass =
  "flex w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-short ease-standard enabled:hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus"

/** The Project's pinned files, at the top of the Documents section: open one, or unpin it. */
export function PinnedArtifacts() {
  const language = useLanguage()
  const sdk = useSDK()
  const artifacts = useArtifacts()
  const references = useFileReferences()
  const list = () => artifacts.list(sdk().directory)
  return (
    <Show when={list().length > 0}>
      <section data-component="pinned-artifacts" class="flex flex-col gap-0.5 pb-2">
        <h3 class="px-2.5 pb-1 pt-1 type-caption text-v2-text-text-muted">
          {language.t("secondBrain.artifacts.pinned")}
        </h3>
        <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
          <For each={list()}>
            {(artifact) => (
              <li class="group/artifact relative">
                <button
                  type="button"
                  data-action="artifact-open"
                  disabled={!references()}
                  title={artifact.path}
                  class={`${rowClass} pr-10`}
                  onClick={() => references()?.onFileReference({ path: artifact.path })}
                >
                  <Icon name="pin" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-[13px] leading-[18px] text-v2-text-text-base">{artifact.name}</span>
                    <Show when={artifact.path.split("/").slice(0, -1).join("/")}>
                      {(folder) => <span class="truncate type-meta text-v2-text-text-muted">{folder()}</span>}
                    </Show>
                  </span>
                </button>
                <TooltipV2
                  class="absolute right-1.5 top-1/2 -translate-y-1/2"
                  placement="left"
                  value={language.t("secondBrain.artifacts.unpin")}
                >
                  <IconButtonV2
                    size="small"
                    variant="ghost-muted"
                    data-action="artifact-unpin"
                    aria-label={language.t("secondBrain.artifacts.unpin")}
                    icon={<Icon name="close" size="small" />}
                    onClick={() => artifacts.remove(sdk().directory, artifact.path)}
                  />
                </TooltipV2>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  )
}

/**
 * The Canvas tab's Files board: every pinned file shown large in its viewer, each with a note for the agent ("this
 * sound doesn't fit", "the rifle's proportions are off"). Send puts the notes in the composer and sends them.
 */
export function ArtifactsBoard() {
  const language = useLanguage()
  const sdk = useSDK()
  const prompt = usePrompt()
  const artifacts = useArtifacts()
  const [notes, setNotes] = createStore<Record<string, string>>({})
  const list = () => artifacts.list(sdk().directory)
  const written = () => list().filter((artifact) => notes[artifact.path]?.trim())

  const send = () => {
    const items = written()
    if (items.length === 0) return
    const text = [
      language.t("secondBrain.artifacts.notes.intro"),
      ...items.map((artifact) =>
        language.t("secondBrain.artifacts.notes.line", {
          name: artifact.name,
          path: artifact.path,
          note: notes[artifact.path]!.trim(),
        }),
      ),
    ].join("\n")
    const parts = [...prompt.current()]
    const end = parts.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)
    parts.push({ type: "text", content: `\n${text}\n`, start: end, end: end + text.length + 2 })
    prompt.set(parts, end + text.length + 2)
    items.forEach((artifact) => setNotes(artifact.path, ""))
    submitComposer()
  }

  return (
    <div data-component="artifacts-board" class="flex h-full min-h-0 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1" data-scrollable>
        <div class="flex flex-col gap-3">
          <For each={list()}>
            {(artifact) => (
              <ArtifactCard
                artifact={artifact}
                note={notes[artifact.path] ?? ""}
                onNote={(value) => setNotes(artifact.path, value)}
              />
            )}
          </For>
        </div>
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-v2-border-border-muted px-3 py-2.5">
        <span class="mr-auto type-meta text-v2-text-text-muted">
          {language.plural("secondBrain.artifacts.notes.count", written().length, { count: written().length })}
        </span>
        <ButtonV2
          size="small"
          variant="contrast"
          data-action="artifacts-send-notes"
          disabled={written().length === 0}
          onClick={send}
        >
          {language.t("secondBrain.artifacts.notes.send")}
        </ButtonV2>
      </div>
    </div>
  )
}

function ArtifactCard(props: { artifact: Artifact; note: string; onNote: (value: string) => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const space = useViewSpace()
  const artifacts = useArtifacts()
  const references = useFileReferences()
  const mount = (host: HTMLDivElement) => {
    const cleanup = space?.render(host, {
      src: props.artifact.path,
      name: props.artifact.name,
      kind: props.artifact.kind,
      remote: false,
    })
    onCleanup(() => typeof cleanup === "function" && cleanup())
  }
  return (
    <article
      data-component="artifact-card"
      data-kind={props.artifact.kind}
      class="overflow-hidden rounded-[16px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
    >
      <header class="flex items-center gap-1.5 py-1.5 pl-3.5 pr-1.5">
        <span
          class="min-w-0 flex-1 truncate text-[13px] font-medium text-v2-text-text-base"
          title={props.artifact.path}
        >
          {props.artifact.name}
        </span>
        <ButtonV2
          size="small"
          variant="ghost"
          disabled={!references()}
          onClick={() => references()?.onFileReference({ path: props.artifact.path })}
        >
          {language.t("secondBrain.message.view.open")}
        </ButtonV2>
        <TooltipV2 placement="bottom" value={language.t("secondBrain.artifacts.unpin")}>
          <IconButtonV2
            size="small"
            variant="ghost-muted"
            aria-label={language.t("secondBrain.artifacts.unpin")}
            icon={<Icon name="close" size="small" />}
            onClick={() => artifacts.remove(sdk().directory, props.artifact.path)}
          />
        </TooltipV2>
      </header>
      <div
        ref={mount}
        data-slot="view-window-body"
        class="flex max-h-[420px] justify-center overflow-auto border-y border-v2-border-border-muted bg-v2-background-bg-base [&>audio]:m-3.5 [&>audio]:w-full [&>iframe]:h-[420px] [&>iframe]:w-full [&>img]:max-h-[420px] [&>img]:object-contain [&>pre]:w-full [&>pre]:whitespace-pre-wrap [&>pre]:p-3.5 [&>pre]:text-[12px] [&>video]:max-h-[420px] [&>[data-slot=view-model]]:h-[360px] [&>[data-slot=view-model]]:w-full [&>[data-slot=view-window-notice]]:p-3.5 [&>[data-slot=view-window-notice]]:type-meta [&>[data-slot=view-window-notice]]:text-v2-text-text-muted"
      />
      <textarea
        data-action="artifact-note"
        rows={2}
        value={props.note}
        placeholder={language.t("secondBrain.artifacts.notes.placeholder")}
        aria-label={language.t("secondBrain.artifacts.notes.label", { name: props.artifact.name })}
        class="block w-full resize-none bg-transparent px-3.5 py-2.5 text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-muted focus-visible:bg-v2-background-bg-layer-02"
        onInput={(event) => props.onNote(event.currentTarget.value)}
      />
    </article>
  )
}
