import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { Reveal } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { SelectV2 } from "@tenon/ui/v2/select-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { PageEmpty } from "@/components/page"
import { HarnessIcon } from "@/components/harness-icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type {
  HarnessSyncMode,
  HarnessSyncPlatform,
  HarnessSyncPresets,
  HarnessSyncStatus,
  HarnessSyncToolID,
  HarnessSyncToolStatus,
} from "@/harness-sync/types"
import { showToast } from "@/utils/toast"
import {
  MODES,
  type Headline,
  headline,
  instructionsChanged,
  logoInstance,
  presetFromFile,
  presetsOf,
  renderPreset,
  sharedUsers,
  toolPreset,
  withInstructions,
} from "./harness-sync-model"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type Translate = ReturnType<typeof useLanguage>["t"]
type Key = Parameters<Translate>[0]

export const shortTime = (iso: string | undefined) => {
  if (!iso) return ""
  const date = new Date(iso)
  return new Date().toDateString() === date.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" })
}

const failed = (language: ReturnType<typeof useLanguage>) => (error: unknown) =>
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: error instanceof Error ? error.message : String(error),
  })

/** The headline's title and detail as text. */
export function headlineText(t: Translate, value: Headline) {
  const list = (names: string[]) => names.join(", ")
  if (value.key === "setup") return [t("harness.sync.headline.setup"), t("harness.sync.headline.setup.detail")]
  if (value.key === "unreadable") return [t("harness.sync.headline.unreadable"), value.detail]
  if (value.key === "failed")
    return [t("harness.sync.headline.failed"), t("harness.sync.headline.failed.detail", { names: list(value.names) })]
  if (value.key === "conflictCopy")
    return [t("harness.sync.headline.conflictCopy"), t("harness.sync.headline.conflictCopy.detail")]
  if (value.key === "outside") return [t("harness.sync.headline.outside"), list(value.names)]
  if (value.key === "waiting") return [t("harness.sync.headline.waiting"), t("harness.sync.headline.waiting.detail")]
  return [
    t("harness.sync.headline.synced"),
    t("harness.sync.headline.synced.detail", { time: shortTime(value.at), name: value.by ?? "" }),
  ]
}

/** Status shared by Settings › Instructions and the sync part of Settings › Skills, refreshed on background changes. */
export function useHarnessSyncStatus(sync: HarnessSyncPlatform) {
  const [status, { mutate, refetch }] = createResource(() => sync.status())
  const off = sync.onChange(() => void refetch())
  onCleanup(off)
  return { status, set: (next: HarnessSyncStatus | null) => next && mutate(next), refetch }
}

/** Settings › Instructions: one set of global instructions written into every harness, synced between computers. */
export function SettingsInstructionsV2() {
  const language = useLanguage()
  const platform = usePlatform()
  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("harness.sync.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="harness-sync-settings">
        <Show
          when={platform.harnessSync}
          fallback={<div class="settings-v2-provider-empty">{language.t("harness.sync.desktopOnly")}</div>}
        >
          {(sync) => <InstructionsBody sync={sync()} />}
        </Show>
      </div>
    </>
  )
}

function InstructionsBody(props: { sync: HarnessSyncPlatform }) {
  const language = useLanguage()
  const t = language.t
  const onError = failed(language)
  const state = useHarnessSyncStatus(props.sync)
  const [busy, setBusy] = createSignal(false)
  const run = (work: () => Promise<HarnessSyncStatus | null>, done?: string) => {
    setBusy(true)
    return work()
      .then((next) => {
        state.set(next)
        if (next && done) showToast({ variant: "success", icon: "circle-check", title: done })
        return next
      })
      .catch((error: unknown) => {
        onError(error)
      })
      .finally(() => setBusy(false))
  }

  return (
    <Switch>
      <Match when={state.status.error}>
        <PageEmpty
          error
          title={t("secondBrain.state.error.title")}
          action={
            <ButtonV2 variant="outline" onClick={() => void state.refetch()}>
              {t("secondBrain.state.retry")}
            </ButtonV2>
          }
        >
          {state.status.error instanceof Error ? state.status.error.message : t("secondBrain.state.error.body")}
        </PageEmpty>
      </Match>
      <Match when={!state.status.latest}>
        <PageEmpty loading title={t("harness.sync.title")} />
      </Match>
      <Match when={state.status.latest?.pending}>
        {(pending) => (
          <JoinView sync={props.sync} status={state.status.latest!} pending={pending()} busy={busy()} run={run} />
        )}
      </Match>
      <Match when={!state.status.latest?.syncFile}>
        <SetupView sync={props.sync} status={state.status.latest!} busy={busy()} run={run} />
      </Match>
      <Match when={state.status.latest}>
        {(status) => <ConnectedView sync={props.sync} status={status()} busy={busy()} run={run} />}
      </Match>
    </Switch>
  )
}

type ViewProps = {
  sync: HarnessSyncPlatform
  status: HarnessSyncStatus
  busy: boolean
  run: (work: () => Promise<HarnessSyncStatus | null>, done?: string) => Promise<unknown>
}

/** Installed harnesses whose instructions file has text: candidates to start the shared preset from. */
const seeds = (status: HarnessSyncStatus) =>
  status.tools.filter((tool) => tool.installed && tool.exists && tool.lines > 0)

function SetupView(props: ViewProps) {
  const language = useLanguage()
  const t = language.t
  const empty = { id: undefined, name: t("harness.sync.setup.seed.empty") }
  const options = createMemo(() => [...seeds(props.status).map((tool) => ({ id: tool.id, name: tool.name })), empty])
  const [seed, setSeed] = createSignal<{ id: HarnessSyncToolID | undefined; name: string }>()
  const current = () => seed() ?? options()[0]
  return (
    <div class="settings-v2-section">
      <h4 class="settings-v2-section-title">{t("harness.sync.setup.title")}</h4>
      <p class="type-meta text-v2-text-text-muted">{t("harness.sync.intro")}</p>
      <p class="type-meta text-v2-text-text-muted">{t("harness.sync.setup.drive")}</p>
      <SettingsListV2>
        <SettingsRowV2 title={t("harness.sync.setup.seed")}>
          <SelectV2
            appearance="inline"
            data-action="harness-sync-seed"
            options={options()}
            current={current()}
            placement="bottom-end"
            gutter={6}
            value={(option) => option.id ?? ""}
            label={(option) => option.name}
            onSelect={(option) => option && setSeed(option)}
          />
        </SettingsRowV2>
      </SettingsListV2>
      <div class="flex flex-wrap gap-2">
        <ButtonV2
          variant="tonal"
          data-action="harness-sync-create"
          disabled={props.busy}
          onClick={() => void props.run(() => props.sync.createSyncFile(current().id))}
        >
          {t("harness.sync.setup.create")}
        </ButtonV2>
        <ButtonV2
          variant="ghost"
          data-action="harness-sync-open"
          disabled={props.busy}
          onClick={() => void props.run(() => props.sync.openSyncFile())}
        >
          {t("harness.sync.setup.open")}
        </ButtonV2>
      </div>
      <HarnessList status={props.status} />
    </div>
  )
}

function JoinView(props: ViewProps & { pending: NonNullable<HarnessSyncStatus["pending"]> }) {
  const language = useLanguage()
  const t = language.t
  const options = createMemo(() => seeds(props.status))
  const [seed, setSeed] = createSignal<HarnessSyncToolStatus>()
  const current = () => seed() ?? options()[0]
  return (
    <div class="settings-v2-section">
      <h4 class="settings-v2-section-title">{t("harness.sync.join.title", { name: props.pending.name })}</h4>
      <p class="type-meta text-v2-text-text-muted">
        {t("harness.sync.join.detail", { name: props.pending.updatedBy, time: shortTime(props.pending.updatedAt) })}
      </p>
      <SettingsListV2>
        <SettingsRowV2 title={t("harness.sync.join.theirs")} description={t("harness.sync.join.theirs.detail")}>
          <ButtonV2
            size="small"
            variant="tonal"
            data-action="harness-sync-join-theirs"
            disabled={props.busy}
            onClick={() => void props.run(() => props.sync.join())}
          >
            {t("harness.sync.join.theirs")}
          </ButtonV2>
        </SettingsRowV2>
        <Show when={current()}>
          {(tool) => (
            <SettingsRowV2
              title={t("harness.sync.join.mine")}
              description={t("harness.sync.join.mine.detail", { name: tool().name })}
            >
              <div class="flex items-center gap-2">
                <SelectV2
                  appearance="inline"
                  options={options()}
                  current={tool()}
                  placement="bottom-end"
                  gutter={6}
                  value={(option) => option.id}
                  label={(option) => option.name}
                  onSelect={(option) => option && setSeed(option)}
                />
                <ButtonV2
                  size="small"
                  variant="ghost"
                  data-action="harness-sync-join-mine"
                  disabled={props.busy}
                  onClick={() => void props.run(() => props.sync.join(tool().id))}
                >
                  {t("harness.sync.join.mine")}
                </ButtonV2>
              </div>
            </SettingsRowV2>
          )}
        </Show>
      </SettingsListV2>
      <div>
        <ButtonV2 variant="ghost" disabled={props.busy} onClick={() => void props.run(() => props.sync.cancelJoin())}>
          {t("common.cancel")}
        </ButtonV2>
      </div>
    </div>
  )
}

/** The harness rows before a sync file is connected: what was found, read-only. */
function HarnessList(props: { status: HarnessSyncStatus }) {
  const language = useLanguage()
  return (
    <SettingsListV2>
      <For each={props.status.tools}>
        {(tool) => (
          <div data-component="settings-v2-row" data-harness={tool.id}>
            <HarnessIcon instance={logoInstance[tool.id]} />
            <div data-slot="settings-v2-row-copy">
              <span data-slot="settings-v2-row-title">{tool.name}</span>
              <span class="block truncate font-mono text-[11px] leading-4 text-v2-text-text-muted">{tool.path}</span>
            </div>
            <Show when={!tool.installed}>
              <span class="shrink-0 type-meta text-v2-text-text-muted">{language.t("harness.sync.notInstalled")}</span>
            </Show>
          </div>
        )}
      </For>
    </SettingsListV2>
  )
}

function ConnectedView(props: ViewProps) {
  const language = useLanguage()
  const t = language.t
  const onError = failed(language)
  const document = () => props.status.document
  const saved = createMemo(() => {
    const doc = document()
    return doc ? presetsOf(doc) : undefined
  })
  const [draft, setDraft] = createStore<HarnessSyncPresets>(
    structuredClone(saved() ?? { shared: "", tools: {}, sharedSkills: [], skillSources: {} }),
  )
  const dirty = () => {
    const base = saved()
    return base ? instructionsChanged(base, draft) : false
  }
  // A newer revision replaces the draft unless the person has unsaved edits.
  createEffect(
    on(
      saved,
      (base, previous) => {
        if (base && (!previous || !instructionsChanged(previous, draft))) setDraft(reconcile(structuredClone(base)))
      },
      { defer: true },
    ),
  )
  const [open, setOpen] = createSignal<HarnessSyncToolID | undefined>()
  const [renaming, setRenaming] = createSignal<string>()
  const [disconnecting, setDisconnecting] = createSignal(false)
  const [mainSeed, setMainSeed] = createSignal<HarnessSyncToolStatus>()
  const heading = createMemo(() => headlineText(t, headline(props.status)))
  const tone = () => headline(props.status).tone
  const users = () => sharedUsers(props.status, draft)

  const setMode = (id: HarnessSyncToolID, mode: HarnessSyncMode) =>
    setDraft("tools", id, { ...toolPreset(draft.tools, id), mode })
  const setText = (id: HarnessSyncToolID, text: string) =>
    setDraft("tools", id, { ...toolPreset(draft.tools, id), text })
  const discard = () => {
    const base = saved()
    if (base) setDraft(reconcile(structuredClone(base)))
  }
  const save = () => {
    const base = saved()
    const doc = document()
    if (!base || !doc) return
    void props.run(() => props.sync.save(withInstructions(base, draft), doc.revision), t("harness.sync.savedToast"))
  }
  const keepFile = (tool: HarnessSyncToolStatus) =>
    void props.sync
      .readToolInstructions(tool.id)
      .then((text) => {
        setDraft("tools", tool.id, { ...toolPreset(draft.tools, tool.id), ...presetFromFile(draft.shared, text) })
        setOpen(tool.id)
      })
      .catch(onError)

  return (
    <div class="flex flex-col gap-6">
      <div
        class="flex items-center gap-3 rounded-[12px] px-4 py-3"
        classList={{
          "bg-v2-background-bg-layer-01": tone() !== "warn" && tone() !== "error",
          "bg-v2-background-bg-layer-02 text-v2-state-fg-warning": tone() === "warn" || tone() === "error",
        }}
        data-component="harness-sync-status"
        data-tone={tone()}
        role="status"
      >
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="type-row-title">{heading()[0]}</span>
          <span class="type-meta truncate opacity-80">{heading()[1]}</span>
        </div>
        <ButtonV2
          size="small"
          variant="neutral"
          icon="reset"
          data-action="harness-sync-now"
          disabled={props.busy}
          onClick={() => void props.run(() => props.sync.syncNow(), t("harness.sync.synced"))}
        >
          {t("harness.sync.syncNow")}
        </ButtonV2>
      </div>

      <Show when={props.status.warning}>
        {(warning) => <p class="type-meta text-v2-state-fg-warning">{warning()}</p>}
      </Show>
      <Show when={props.status.syncFile?.conflictCopies.length}>
        <p class="type-meta text-v2-state-fg-warning" role="alert">
          {t("harness.sync.conflictCopies", { names: props.status.syncFile!.conflictCopies.join(", ") })}
        </p>
      </Show>

      <div class="settings-v2-section">
        <h4 class="settings-v2-section-title">{t("harness.sync.section.computers")}</h4>
        <SettingsListV2>
          <SettingsRowV2
            title={t("harness.sync.file")}
            description={<span class="font-mono text-[11px] break-all">{props.status.syncFile?.path}</span>}
          >
            <div class="flex items-center gap-2">
              <ButtonV2
                size="small"
                variant="ghost"
                disabled={props.busy || dirty()}
                onClick={() => void props.run(() => props.sync.openSyncFile())}
              >
                {t("harness.sync.file.choose")}
              </ButtonV2>
              <ButtonV2
                size="small"
                variant="ghost"
                data-action="harness-sync-disconnect"
                disabled={props.busy || dirty()}
                onClick={() => setDisconnecting(true)}
              >
                {t("harness.sync.disconnect")}
              </ButtonV2>
            </div>
          </SettingsRowV2>
          <Show when={disconnecting()}>
            <SettingsRowV2 title={t("harness.sync.disconnect.confirm")}>
              <div class="flex items-center gap-2">
                <ButtonV2 size="small" variant="ghost" onClick={() => setDisconnecting(false)}>
                  {t("common.cancel")}
                </ButtonV2>
                <ButtonV2
                  size="small"
                  variant="danger"
                  data-action="harness-sync-disconnect-confirm"
                  disabled={props.busy}
                  onClick={() => void props.run(() => props.sync.disconnect()).then(() => setDisconnecting(false))}
                >
                  {t("harness.sync.disconnect")}
                </ButtonV2>
              </div>
            </SettingsRowV2>
          </Show>
          <SettingsRowV2
            title={t("harness.sync.device")}
            description={
              <Show
                when={renaming() !== undefined}
                fallback={`${props.status.deviceName} · ${t("harness.sync.device.detail")}`}
              >
                <TextInputV2
                  value={renaming() ?? ""}
                  aria-label={t("harness.sync.device.label")}
                  maxLength={64}
                  onInput={(event) => setRenaming(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenaming(undefined)
                    if (event.key === "Enter")
                      void props
                        .run(() => props.sync.setDeviceName(renaming() ?? ""))
                        .then(() => setRenaming(undefined))
                  }}
                />
              </Show>
            }
          >
            <ButtonV2
              size="small"
              variant="ghost"
              disabled={props.busy}
              onClick={() =>
                renaming() === undefined
                  ? setRenaming(props.status.deviceName)
                  : void props.run(() => props.sync.setDeviceName(renaming() ?? "")).then(() => setRenaming(undefined))
              }
            >
              {renaming() === undefined ? t("harness.sync.device.rename") : t("common.save")}
            </ButtonV2>
          </SettingsRowV2>
          <Show when={seeds(props.status)[0]}>
            {(first) => {
              const tool = () => mainSeed() ?? first()
              return (
                <SettingsRowV2
                  title={t("harness.sync.makeMain")}
                  description={t("harness.sync.makeMain.detail", { name: tool().name })}
                >
                  <div class="flex items-center gap-2">
                    <SelectV2
                      appearance="inline"
                      options={seeds(props.status)}
                      current={tool()}
                      placement="bottom-end"
                      gutter={6}
                      value={(option) => option.id}
                      label={(option) => option.name}
                      onSelect={(option) => option && setMainSeed(option)}
                    />
                    <ButtonV2
                      size="small"
                      variant="ghost"
                      data-action="harness-sync-make-main"
                      disabled={props.busy || dirty() || !document()}
                      onClick={() => void props.run(() => props.sync.useThisComputer(tool().id, document()!.revision))}
                    >
                      {t("harness.sync.makeMain.action")}
                    </ButtonV2>
                  </div>
                </SettingsRowV2>
              )
            }}
          </Show>
        </SettingsListV2>
      </div>

      <Show when={document()}>
        <div class="settings-v2-section">
          <div class="flex items-baseline justify-between gap-3">
            <h4 class="settings-v2-section-title">{t("harness.sync.section.shared")}</h4>
            <span class="type-meta text-v2-text-text-muted">
              {users().length
                ? t("harness.sync.sharedUsers", { names: users().join(", ") })
                : t("harness.sync.sharedUsers.none")}
            </span>
          </div>
          <TextareaV2
            class="!w-full font-mono text-[12.5px]"
            rows={8}
            spellcheck={false}
            data-action="harness-sync-shared"
            aria-label={t("harness.sync.section.shared")}
            value={draft.shared}
            onInput={(event) => setDraft("shared", event.currentTarget.value)}
          />
        </div>

        <div class="settings-v2-section">
          <div class="flex items-baseline justify-between gap-3">
            <h4 class="settings-v2-section-title">{t("harness.sync.section.harnesses")}</h4>
            <span class="type-meta text-v2-text-text-muted">{t("harness.sync.section.harnesses.detail")}</span>
          </div>
          <SettingsListV2>
            <For each={props.status.tools}>
              {(tool) => (
                <HarnessRow
                  tool={tool}
                  draft={draft}
                  open={open() === tool.id}
                  onToggle={() => setOpen(open() === tool.id ? undefined : tool.id)}
                  onMode={(mode) => setMode(tool.id, mode)}
                  onText={(text) => setText(tool.id, text)}
                  onKeep={() => keepFile(tool)}
                  onReplace={() => void props.run(() => props.sync.syncNow(), t("harness.sync.synced"))}
                  busy={props.busy}
                />
              )}
            </For>
          </SettingsListV2>
        </div>

        <div class="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-v2-border-border-muted bg-v2-background-bg-base py-3">
          <span
            class="flex-1 type-meta"
            classList={{ "text-v2-state-fg-warning": dirty(), "text-v2-text-text-muted": !dirty() }}
            role="status"
          >
            {dirty() ? t("harness.sync.unsaved") : t("harness.sync.saved")}
          </span>
          <ButtonV2 size="small" variant="ghost" disabled={!dirty() || props.busy} onClick={discard}>
            {t("harness.sync.discard")}
          </ButtonV2>
          <ButtonV2
            size="small"
            variant="contrast"
            data-action="harness-sync-save"
            disabled={!dirty() || props.busy}
            onClick={save}
          >
            {t("harness.sync.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}

function HarnessRow(props: {
  tool: HarnessSyncToolStatus
  draft: HarnessSyncPresets
  open: boolean
  busy: boolean
  onToggle: () => void
  onMode: (mode: HarnessSyncMode) => void
  onText: (text: string) => void
  onKeep: () => void
  onReplace: () => void
}) {
  const language = useLanguage()
  const t = language.t
  const preset = () => toolPreset(props.draft.tools, props.tool.id)
  const rendered = () => renderPreset(props.draft.shared, preset())
  const pill = () =>
    !props.tool.installed
      ? t("harness.sync.notInstalled")
      : props.tool.editedOutside
        ? t("harness.sync.changedOutside")
        : t(`harness.sync.mode.${preset().mode}` as Key)

  return (
    <div class="settings-v2-harness-group" data-harness={props.tool.id}>
      <div class="settings-v2-harness-group-row">
        <button
          type="button"
          class="settings-v2-harness-group-toggle"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <Icon name="chevron-down" class="settings-v2-harness-group-chevron" />
          <HarnessIcon instance={logoInstance[props.tool.id]} />
          <span class="flex min-w-0 flex-col items-start">
            <span class="settings-v2-provider-name truncate" classList={{ "opacity-50": !props.tool.installed }}>
              {props.tool.name}
            </span>
            <span class="max-w-full truncate font-mono text-[11px] leading-4 text-v2-text-text-muted">
              {props.tool.path}
            </span>
          </span>
        </button>
        <span
          class="shrink-0 rounded-full px-2 text-[11px] leading-5"
          classList={{
            "bg-v2-background-bg-layer-02 text-v2-state-fg-warning": props.tool.editedOutside,
            "bg-v2-background-bg-layer-02 text-v2-text-text-muted": !props.tool.editedOutside,
          }}
        >
          {pill()}
        </span>
      </div>
      <Reveal open={props.open}>
        <div class="flex flex-col gap-3 pb-4 pl-9 pr-4 pt-1">
          <Show when={props.tool.editedOutside}>
            <div class="flex flex-wrap items-center gap-2 rounded-[10px] bg-v2-background-bg-layer-02 px-3 py-2 type-meta text-v2-state-fg-warning">
              <span class="min-w-0 flex-1">{t("harness.sync.outside.detail")}</span>
              <ButtonV2 size="small" variant="ghost" disabled={props.busy} onClick={props.onKeep}>
                {t("harness.sync.outside.keep")}
              </ButtonV2>
              <ButtonV2 size="small" variant="ghost" disabled={props.busy} onClick={props.onReplace}>
                {t("harness.sync.outside.replace")}
              </ButtonV2>
            </div>
          </Show>
          <Show when={props.tool.state === "error" && props.tool.message}>
            <p class="type-meta text-v2-text-text-critical" role="alert">
              {props.tool.message}
            </p>
          </Show>
          <div class="settings-v2-fit">
            <SegmentedControlV2
              aria-label={t("harness.sync.mode.label", { name: props.tool.name })}
              value={preset().mode}
              onChange={(value) => value && props.onMode(value as HarnessSyncMode)}
            >
              <For each={MODES}>
                {(mode) => (
                  <SegmentedControlItemV2 value={mode}>{t(`harness.sync.mode.${mode}` as Key)}</SegmentedControlItemV2>
                )}
              </For>
            </SegmentedControlV2>
          </div>
          <Show when={preset().mode === "append" || preset().mode === "custom"}>
            <span class="type-caption text-v2-text-text-muted">
              {preset().mode === "append" ? t("harness.sync.extra") : t("harness.sync.own", { name: props.tool.name })}
            </span>
            <TextareaV2
              class="!w-full font-mono text-[12.5px]"
              rows={4}
              spellcheck={false}
              aria-label={
                preset().mode === "append" ? t("harness.sync.extra") : t("harness.sync.own", { name: props.tool.name })
              }
              value={preset().text}
              onInput={(event) => props.onText(event.currentTarget.value)}
            />
          </Show>
          <Show when={!props.tool.installed}>
            <p class="type-meta text-v2-text-text-muted">
              {t("harness.sync.notInstalled.detail", { name: props.tool.name })}
            </p>
          </Show>
          <Show
            when={rendered() !== undefined}
            fallback={
              <p class="type-meta text-v2-text-text-muted">{t("harness.sync.leftAlone", { name: props.tool.name })}</p>
            }
          >
            <span class="type-caption text-v2-text-text-muted">
              {t("harness.sync.preview", { name: props.tool.name })}
            </span>
            <pre class="m-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-v2-background-bg-layer-02 px-3 py-2 font-mono text-[12px] leading-5">
              {rendered()}
            </pre>
          </Show>
        </div>
      </Reveal>
    </div>
  )
}
