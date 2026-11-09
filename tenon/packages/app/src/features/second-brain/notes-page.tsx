import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { KeybindV2 } from "@tenon/ui/v2/keybind-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { Reveal, RevealShow } from "@tenon/ui/v2/reveal"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createEffect, createMemo, createResource, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { PageHeader, pageWideColumnClass } from "@/components/page"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
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
import { bodyAfterSave, newPagePath } from "./notes-timeline"
import { DialogPageVersions } from "./page-versions"
import { DialogConfirmReload, useUnsavedGuard } from "./unsaved-guard"
import { DateChip } from "./project-controls"

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
  /** Leaves the page and deletes it once its Undo window closes. */
  onDelete: (page: { path: string; title: string; revision: string }) => void
  /** Reports unsaved edits, so the page can hold its workspace until they are saved or discarded. */
  onDirty: (dirty: boolean) => void
  /** The sidebar switched workspace while this page had unsaved edits. */
  held: boolean
}) {
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
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
    /** The last save met a newer revision; offer to reload or keep the text as a copy. */
    conflict: false,
    /** The page is gone (deleted elsewhere); the text can still become a copy. */
    missing: false,
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
      missing: false,
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
    if (!dirty()) return true
    if (state.saving) return false
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
    if (path !== props.path) return false
    const saved = result.page
    if (!saved) {
      const status = result.error instanceof SecondBrainRequestError ? result.error.status : 0
      const conflict = status === 409
      const missing = status === 404
      setState({
        error: language.t(
          conflict ? "secondBrain.vault.conflict" : missing ? "secondBrain.vault.missing" : "secondBrain.error.request",
        ),
        conflict,
        missing,
      })
      return false
    }
    // Text typed while the request ran stays unsaved; the rest takes the server copy.
    setState({
      ...bodyAfterSave(state.body, sent.body, saved.body),
      ...(state.title === sent.title ? { title: saved.info.title } : {}),
      ...(JSON.stringify(state.properties) === sent.properties ? { properties: { ...saved.info.properties } } : {}),
      baseTitle: saved.info.title,
      baseProperties: JSON.stringify(saved.info.properties),
      revision: saved.revision,
      updatedAt: saved.info.updatedAt,
      error: "",
      conflict: false,
      missing: false,
    })
    props.onSaved(saved.info)
    return true
  }

  const reload = () => {
    setState({ error: "", conflict: false, missing: false })
    void pageActions.refetch()
  }
  const dropEdits = () =>
    setState({ body: state.baseBody, title: state.baseTitle, properties: JSON.parse(state.baseProperties), error: "" })
  // Reloading replaces the text, so it asks while there is text to lose.
  const confirmReload = () => {
    if (!dirty()) return reload()
    void dialog.show(() => <DialogConfirmReload onReload={reload} onCopy={() => void saveCopy()} />)
  }
  const discard = () => (state.conflict ? confirmReload() : dropEdits())

  // Keeps the text in a new page beside this one, then returns this page to what is on disk.
  const saveCopy = async () => {
    if (state.saving) return
    const missing = state.missing
    const slash = props.path.lastIndexOf("/")
    const folder = slash < 0 ? "" : props.path.slice(0, slash)
    const title = [
      ...language.t("secondBrain.vault.copyTitle", {
        title: state.title.trim() || language.t("secondBrain.vault.untitled"),
      }),
    ]
      .slice(0, 200)
      .join("")
    // File names are shorter than titles.
    const name = newPagePath([...title].slice(0, 100).join(""), folder, props.pages)
    setState("saving", true)
    const copy = await writeVaultPage(props.client, {
      path: folder ? `${folder}/${name}` : name,
      body: state.body,
      title,
      properties: propertiesChanged() ? { ...state.properties } : undefined,
      create: true,
    }).catch(() => undefined)
    setState("saving", false)
    if (!copy) return setState("error", language.t("secondBrain.error.request"))
    props.onSaved(copy.info)
    showToast({
      description: language.t("secondBrain.vault.copySaved", { title: copy.info.title }),
      actions: [{ label: language.t("common.open"), onClick: () => props.onOpen(copy.info.path) }],
    })
    if (!missing) return reload()
    dropEdits()
    props.onOpen(copy.info.path)
  }

  const restore = (body: string) => {
    setState("body", body)
    void save()
  }
  const openVersions = () =>
    void dialog.show(() => (
      <DialogPageVersions client={props.client} path={props.path} blocked={dirty()} onRestore={restore} />
    ))

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

  useUnsavedGuard({
    dirty,
    save,
    discard: dropEdits,
    body: () => language.t("secondBrain.unsaved.page"),
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
    <span class="hidden shrink-0 items-center gap-1.5 px-1 type-caption text-v2-text-text-muted sm:flex">
      <Reveal open={dirty()} variant="inline">
        <span class="block size-1.5 rounded-full bg-v2-icon-icon-accent" aria-hidden="true" />
      </Reveal>
      {dirty() ? language.t("secondBrain.notes.unsaved") : language.t("secondBrain.notes.saved")}
    </span>
  )

  // Also in the fullscreen toolbar, where the page's own error line sits behind the editor.
  const recoveryActions = () => (
    <>
      <Show when={state.conflict || state.missing}>
        <ButtonV2 size="small" variant="outline" disabled={state.saving} onClick={() => void saveCopy()}>
          {language.t("secondBrain.vault.saveCopy")}
        </ButtonV2>
      </Show>
      <Show when={state.conflict}>
        <ButtonV2 size="small" variant="outline" disabled={page.loading} onClick={confirmReload}>
          {language.t("secondBrain.notes.reload")}
        </ButtonV2>
      </Show>
    </>
  )

  // Front matter properties: text and dates edit in place, booleans tick, `status` picks a timeline status; lists,
  // numbers and other values show as read-only text. Edits save with the page.
  const properties = () => (
    <Show when={Object.keys(state.properties).length > 0}>
      <dl
        aria-label={language.t("secondBrain.vault.properties")}
        class="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2 text-[13px] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
      >
        <For each={Object.keys(state.properties)}>
          {(key) => {
            const value = () => state.properties[key]
            const set = (next: string | boolean) => setState("properties", key, next)
            return (
              <>
                <dt class="min-w-0 truncate type-meta text-v2-text-text-muted" title={key}>
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
                      <DateChip label={key} value={String(value()).slice(0, 10)} onChange={(next) => set(next ?? "")} />
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
      <PageHeader
        crumb
        title={
          project()
            ? language.t("secondBrain.vault.breadcrumb", { project: project()!.name, page: state.title })
            : state.title
        }
        back={{ label: language.t("secondBrain.vault.back"), onClick: props.onBack }}
        actions={
          <>
            {savedState()}
            <Reveal open={dirty()} variant="inline">
              <ButtonV2 size="small" variant="ghost" disabled={state.saving} onClick={discard}>
                {language.t("secondBrain.notes.discard")}
              </ButtonV2>
            </Reveal>
            {saveButton()}
            <MenuV2 gutter={4} modal={false} placement="bottom-end">
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                class="!size-8"
                icon={<Icon name="outline-dots" size="small" />}
                aria-label={language.t("secondBrain.vault.actions")}
              />
              <MenuV2.Portal>
                <MenuV2.Content>
                  <MenuV2.Item disabled={!state.revision} onSelect={openVersions}>
                    {language.t("secondBrain.vault.versions")}
                  </MenuV2.Item>
                  {/* Unsaved edits would go with the page, so they are saved or discarded first. */}
                  <MenuV2.Item
                    disabled={!state.revision || dirty() || state.saving}
                    onSelect={() => props.onDelete({ path: props.path, title: state.title, revision: state.revision })}
                  >
                    {language.t("secondBrain.vault.delete")}
                  </MenuV2.Item>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
          </>
        }
      />

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class={`${pageWideColumnClass} min-h-full`}>
          <h1 class="type-display text-v2-text-text-base">
            <input
              class="w-full min-w-0 rounded-[12px] bg-transparent px-1 -mx-1 outline-none transition-colors duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
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
          <div class="flex flex-wrap items-center gap-2 type-meta text-v2-text-text-muted">
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
                <p role="alert" class="type-meta text-v2-text-text-critical">
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
                <p role="alert" class="type-meta text-v2-text-text-critical">
                  {error()}
                </p>
                {recoveryActions()}
              </div>
            )}
          </RevealShow>

          <div class="flex min-h-[420px] flex-1">
            <NoteEditor
              value={state.body}
              onOpenNote={props.onOpen}
              preview={(text) => previewNoteLinks(text, linkLookup())}
              loading={page.loading}
              onChange={(value) => setState("body", value)}
              onSave={() => void save()}
              commandLabel={(id) => language.t(`secondBrain.notes.command.${id}`)}
              fullscreenActions={
                <>
                  <Show when={state.error}>
                    <span class="max-w-64 truncate type-meta text-v2-text-text-critical" title={state.error}>
                      {state.error}
                    </span>
                  </Show>
                  {recoveryActions()}
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
