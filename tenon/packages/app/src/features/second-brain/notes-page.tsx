import { useBeforeLeave } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { Reveal, RevealShow } from "@tenon/ui/v2/reveal"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createEffect, createMemo, createResource, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import {
  readVaultPage,
  SecondBrainRequestError,
  writeVaultPage,
  type ProjectRecord,
  type VaultPage,
  type VaultPageInfo,
} from "./client"
import { NoteEditor } from "./note-editor"
import { noteLinkLookup, previewNoteLinks } from "./note-links"

type VaultClient = Parameters<typeof readVaultPage>[0]

const pageStatuses = ["todo", "doing", "done"] as const
const propertyField =
  "h-7 min-w-0 rounded-full bg-transparent px-2 text-[13px] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"

/**
 * One vault page, full width: title, Project, Markdown body and Save. Saving sends the revision it loaded, so a
 * page changed elsewhere (another machine, a sync, an agent) is never overwritten unseen.
 */
export function NotesPageView(props: {
  client: VaultClient
  path: string
  pages: ReadonlyArray<VaultPageInfo>
  projects: ReadonlyArray<ProjectRecord>
  onBack: () => void
  onOpen: (path: string) => void
  onSaved: (info: VaultPageInfo) => void
  /** Reports unsaved edits, so the page can hold its workspace until they are saved or discarded. */
  onDirty: (dirty: boolean) => void
  /** The sidebar switched workspace while this page had unsaved edits. */
  held: boolean
}) {
  const language = useLanguage()
  const command = useCommand()
  const [state, setState] = createStore({
    body: "",
    baseBody: "",
    title: "",
    baseTitle: "",
    revision: "",
    projectId: null as string | null,
    updatedAt: "",
    /** Front matter properties as edited, and as loaded (JSON, to compare). */
    properties: {} as Record<string, unknown>,
    baseProperties: "{}",
    saving: false,
    error: "",
    /** The last save met a newer revision; offer to reload. */
    conflict: false,
  })
  const propertiesChanged = () => JSON.stringify(state.properties) !== state.baseProperties
  const dirty = createMemo(
    () =>
      state.revision !== "" &&
      (state.body !== state.baseBody || state.title !== state.baseTitle || propertiesChanged()),
  )
  createEffect(() => props.onDirty(dirty()))
  onCleanup(() => props.onDirty(false))
  const [page, pageActions] = createResource(
    () => props.path,
    (path) => readVaultPage(props.client, path),
  )
  const apply = (document: VaultPage) =>
    setState({
      body: document.body,
      baseBody: document.body,
      title: document.info.title,
      baseTitle: document.info.title,
      revision: document.revision,
      projectId: document.info.projectId,
      updatedAt: document.info.updatedAt,
      // A copy: edits must not write into the loaded document.
      properties: { ...document.info.properties },
      baseProperties: JSON.stringify(document.info.properties),
      error: "",
      conflict: false,
    })
  createEffect(
    on(
      () => (page.error ? undefined : page()),
      (document) => document && apply(document),
    ),
  )

  const project = () => props.projects.find((item) => item.id === state.projectId)
  const linkLookup = createMemo(() => noteLinkLookup(props.pages))

  const save = async () => {
    if (!dirty() || state.saving) return
    const sent = { body: state.body, title: state.title, properties: JSON.stringify(state.properties) }
    const path = props.path
    setState({ saving: true, error: "" })
    const result = await writeVaultPage(props.client, {
      path,
      body: sent.body,
      title: sent.title.trim() || undefined,
      // Only an edited set is sent: the server replaces all properties and refuses ones it cannot write back.
      properties: propertiesChanged() ? { ...state.properties } : undefined,
      expectedRevision: state.revision,
    }).then(
      (page) => ({ page, error: undefined }),
      (error: unknown) => ({ page: undefined, error }),
    )
    setState("saving", false)
    if (path !== props.path) return
    const saved = result.page
    if (!saved) {
      const conflict = result.error instanceof SecondBrainRequestError && result.error.status === 409
      return setState({
        error: language.t(conflict ? "secondBrain.vault.conflict" : "secondBrain.error.request"),
        conflict,
      })
    }
    // Text typed while the request ran stays unsaved; the rest takes the server copy.
    setState({
      ...(state.body === sent.body ? { body: saved.body } : {}),
      ...(state.title === sent.title ? { title: saved.info.title } : {}),
      ...(JSON.stringify(state.properties) === sent.properties ? { properties: { ...saved.info.properties } } : {}),
      baseBody: saved.body,
      baseTitle: saved.info.title,
      baseProperties: JSON.stringify(saved.info.properties),
      revision: saved.revision,
      updatedAt: saved.info.updatedAt,
      error: "",
      conflict: false,
    })
    props.onSaved(saved.info)
  }

  const reload = () => {
    setState({ error: "", conflict: false })
    void pageActions.refetch()
  }
  const discard = () => {
    if (state.conflict) return reload()
    setState({ body: state.baseBody, title: state.baseTitle, properties: JSON.parse(state.baseProperties), error: "" })
  }

  command.register("notes", () => [
    {
      id: "notes.save",
      title: language.t("secondBrain.vault.saveCommand"),
      category: language.t("command.category.file"),
      keybind: "mod+s",
      disabled: !dirty() || state.saving,
      onSelect: () => void save(),
    },
  ])

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty()) return
    event.preventDefault()
    event.returnValue = ""
  }
  window.addEventListener("beforeunload", beforeUnload)
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload))
  useBeforeLeave((event) => {
    if (!dirty()) return
    event.preventDefault()
    setState("error", language.t("secondBrain.vault.unsaved"))
  })

  const saveButton = () => (
    <TooltipV2
      value={
        <>
          {language.t("common.save")}
          <KeybindV2 keys={command.keybindParts("notes.save")} variant="neutral" />
        </>
      }
    >
      <ButtonV2 size="small" variant="contrast" disabled={!dirty() || state.saving} onClick={() => void save()}>
        {state.saving ? language.t("secondBrain.saving") : language.t("common.save")}
      </ButtonV2>
    </TooltipV2>
  )
  const savedState = () => (
    <span class="hidden shrink-0 items-center gap-1.5 px-1 text-[11px] text-v2-text-text-faint sm:flex">
      <Reveal open={dirty()} variant="inline">
        <span class="block size-1.5 rounded-full bg-v2-icon-icon-accent" aria-hidden="true" />
      </Reveal>
      {dirty() ? language.t("secondBrain.notes.unsaved") : language.t("secondBrain.notes.saved")}
    </span>
  )

  // Front matter properties: text and dates edit in place, booleans tick, `status` picks a timeline status; lists,
  // numbers and other values show as read-only text. Edits save with the page.
  const properties = () => (
    <Show when={Object.keys(state.properties).length > 0}>
      <dl
        aria-label={language.t("secondBrain.vault.properties")}
        class="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2 text-[13px]"
      >
        <For each={Object.keys(state.properties)}>
          {(key) => {
            const value = () => state.properties[key]
            const set = (next: string | boolean) => setState("properties", key, next)
            return (
              <>
                <dt class="min-w-0 truncate text-[12px] text-v2-text-text-muted" title={key}>
                  {key}
                </dt>
                <dd class="min-w-0">
                  <Switch
                    fallback={
                      <span class="block truncate px-2 text-v2-text-text-base">
                        {(() => {
                          const current = value()
                          return Array.isArray(current) ? current.join(", ") : String(current ?? "")
                        })()}
                      </span>
                    }
                  >
                    <Match when={typeof value() === "boolean"}>
                      <span class="flex h-7 items-center px-2">
                        <CheckboxV2 hideLabel label={key} checked={value() === true} onChange={set} />
                      </span>
                    </Match>
                    <Match when={key === "status" && typeof value() === "string"}>
                      <select
                        class={propertyField}
                        aria-label={key}
                        value={String(value())}
                        onChange={(event) => set(event.currentTarget.value)}
                      >
                        <Show when={!pageStatuses.some((status) => status === value())}>
                          <option value={String(value())}>{String(value())}</option>
                        </Show>
                        <For each={pageStatuses}>
                          {(status) => (
                            <option value={status}>{language.t(`secondBrain.vault.status.${status}`)}</option>
                          )}
                        </For>
                      </select>
                    </Match>
                    <Match when={typeof value() === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(value()))}>
                      <input
                        type="date"
                        class={`${propertyField} tabular-nums`}
                        aria-label={key}
                        value={String(value()).slice(0, 10)}
                        onInput={(event) => set(event.currentTarget.value)}
                      />
                    </Match>
                    <Match when={typeof value() === "string"}>
                      <input
                        class={`${propertyField} w-full`}
                        aria-label={key}
                        value={String(value())}
                        onInput={(event) => set(event.currentTarget.value)}
                      />
                    </Match>
                  </Switch>
                </dd>
              </>
            )
          }}
        </For>
      </dl>
    </Show>
  )

  return (
    <article class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header class="flex min-h-14 shrink-0 items-center gap-2 pl-3 pr-3 pt-3">
        <TooltipV2 value={language.t("secondBrain.vault.back")}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            class="!size-8"
            aria-label={language.t("secondBrain.vault.back")}
            icon={<Icon name="arrow-left" size="small" />}
            onClick={props.onBack}
          />
        </TooltipV2>
        <p class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted">
          {project()
            ? language.t("secondBrain.vault.breadcrumb", { project: project()!.name, page: state.title })
            : state.title}
        </p>
        {savedState()}
        <Reveal open={dirty()} variant="inline">
          <ButtonV2 size="small" variant="ghost" disabled={state.saving} onClick={discard}>
            {language.t("secondBrain.notes.discard")}
          </ButtonV2>
        </Reveal>
        {saveButton()}
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex min-h-full w-full max-w-[920px] flex-col gap-3 px-6 pb-8 pt-4 sm:px-12">
          <h1 class="text-[30px] leading-10 text-v2-text-text-base [font-weight:700]">
            <input
              class="w-full min-w-0 rounded-[12px] bg-transparent px-1 -mx-1 outline-none transition-colors duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none [font-weight:700]"
              aria-label={language.t("secondBrain.vault.pageTitle")}
              placeholder={language.t("secondBrain.vault.untitled")}
              value={state.title}
              onInput={(event) => setState("title", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                event.currentTarget.closest("article")?.querySelector("textarea")?.focus()
              }}
            />
          </h1>
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-v2-text-text-muted">
            <Show when={project()}>
              {(item) => (
                <span class="rounded-full bg-v2-background-bg-accent-container px-2.5 py-0.5 text-v2-text-text-on-accent-container">
                  {item().name}
                </span>
              )}
            </Show>
            {/* A hand-edited `updated_at` may not parse; the server then sends "". */}
            <Show when={Number.isFinite(Date.parse(state.updatedAt))}>
              <span class="tabular-nums">
                {language.t("secondBrain.vault.edited", {
                  time: new Date(state.updatedAt).toLocaleString(language.intl(), {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </span>
            </Show>
          </div>
          {properties()}

          <RevealShow when={!!page.error}>
            {() => (
              <div class="flex flex-wrap items-center gap-2">
                <p role="alert" class="text-[12px] text-v2-text-text-critical">
                  {language.t("secondBrain.error.request")}
                </p>
                <ButtonV2 size="small" variant="outline" onClick={reload}>
                  {language.t("secondBrain.error.retry")}
                </ButtonV2>
              </div>
            )}
          </RevealShow>
          <RevealShow when={state.error || (props.held ? language.t("secondBrain.vault.unsaved") : "")}>
            {(error) => (
              <div class="flex flex-wrap items-center gap-2">
                <p role="alert" class="text-[12px] text-v2-text-text-critical">
                  {error()}
                </p>
                <Show when={state.conflict}>
                  <ButtonV2 size="small" variant="outline" disabled={page.loading} onClick={reload}>
                    {language.t("secondBrain.notes.reload")}
                  </ButtonV2>
                </Show>
              </div>
            )}
          </RevealShow>

          <div class="flex min-h-[420px] flex-1">
            <NoteEditor
              value={state.body}
              onOpenNote={props.onOpen}
              previewText={previewNoteLinks(state.body, linkLookup())}
              loading={page.loading}
              onChange={(value) => setState("body", value)}
              onSave={save}
              commandLabel={(id) => language.t(`secondBrain.notes.command.${id}`)}
              fullscreenActions={
                <>
                  {savedState()}
                  {saveButton()}
                </>
              }
              labels={{
                words: (count) => language.t("secondBrain.notes.words", { count }),
                previewRegion: language.t("secondBrain.notes.previewRegion"),
                fullscreen: language.t("secondBrain.notes.fullscreen"),
                exitFullscreen: language.t("secondBrain.notes.exitFullscreen"),
                sideBySide: language.t("secondBrain.notes.sideBySide"),
                stacked: language.t("secondBrain.notes.stacked"),
                resize: language.t("secondBrain.notes.resize"),
                slashMenu: language.t("secondBrain.notes.slashMenu"),
                slashEmpty: language.t("secondBrain.notes.slashEmpty"),
                placeholder: language.t("secondBrain.notes.placeholder"),
                insert: language.t("secondBrain.notes.insert"),
                editor: language.t("secondBrain.notes.editor"),
                toolbar: language.t("secondBrain.notes.format.toolbar"),
                write: language.t("secondBrain.notes.write"),
                split: language.t("secondBrain.notes.split"),
                preview: language.t("secondBrain.notes.preview"),
              }}
            />
          </div>
        </div>
      </div>
    </article>
  )
}
