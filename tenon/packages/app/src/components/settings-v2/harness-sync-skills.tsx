import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { HarnessIcon } from "@/components/harness-icon"
import { useLanguage } from "@/context/language"
import type {
  HarnessSyncMode,
  HarnessSyncPlatform,
  HarnessSyncPresets,
  HarnessSyncStatus,
  HarnessSyncToolID,
} from "@/harness-sync/types"
import { showToast } from "@/utils/toast"
import {
  MODES,
  editedSkills,
  logoInstance,
  presetsOf,
  shareable,
  skillsChanged,
  toolPreset,
  withSkills,
} from "./harness-sync-model"
import { useHarnessSyncStatus } from "./instructions"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

type Key = Parameters<ReturnType<typeof useLanguage>["t"]>[0]

/**
 * The sync part of Settings › Skills: the shared skill set, what each harness's skills folder gets, and the skills
 * found on this computer that can be shared. Saving writes the sync file and copies skills into each folder.
 */
export function HarnessSyncSkills(props: { sync: HarnessSyncPlatform }) {
  const language = useLanguage()
  const t = language.t
  const state = useHarnessSyncStatus(props.sync)
  return (
    <section class="settings-v2-section" data-component="harness-sync-skills">
      <h3 class="settings-v2-section-title">{t("harness.sync.skills.title")}</h3>
      <Show
        when={state.status.latest?.document && state.status.latest}
        fallback={
          <Show when={state.status.latest}>
            <p class="type-meta text-v2-text-text-muted">{t("harness.sync.skills.setup")}</p>
          </Show>
        }
      >
        {(status) => <SkillsEditor sync={props.sync} status={status()} onStatus={state.set} />}
      </Show>
    </section>
  )
}

function SkillsEditor(props: {
  sync: HarnessSyncPlatform
  status: HarnessSyncStatus
  onStatus: (status: HarnessSyncStatus | null) => void
}) {
  const language = useLanguage()
  const t = language.t
  const saved = createMemo(() => presetsOf(props.status.document!))
  const [draft, setDraft] = createStore<HarnessSyncPresets>(structuredClone(saved()))
  const [busy, setBusy] = createSignal(false)
  const dirty = () => skillsChanged(saved(), draft)
  createEffect(
    on(
      saved,
      (base, previous) => {
        if (!previous || !skillsChanged(previous, draft)) setDraft(reconcile(structuredClone(base)))
      },
      { defer: true },
    ),
  )
  const installed = () => props.status.tools.filter((tool) => tool.installed)
  const library = () => props.status.skills.library
  const local = createMemo(() => shareable(props.status, draft))
  const edited = createMemo(() => editedSkills(props.status))
  // A skill can be picked as an extra when it is in the sync file or staged for upload from this computer.
  const extraOptions = createMemo(() => [
    ...new Set([...library().map((skill) => skill.name), ...local().map((skill) => skill.name)]),
  ])
  const sourceOf = (name: string) => local().find((skill) => skill.name === name)?.tool

  const share = (name: string, tool: HarnessSyncToolID) => {
    setDraft("sharedSkills", [...draft.sharedSkills, name])
    if (!library().some((skill) => skill.name === name)) setDraft("skillSources", name, tool)
  }
  const unshare = (name: string) =>
    setDraft(
      "sharedSkills",
      draft.sharedSkills.filter((item) => item !== name),
    )
  const setMode = (id: HarnessSyncToolID, skillMode: HarnessSyncMode) =>
    setDraft("tools", id, { ...toolPreset(draft.tools, id), skillMode })
  const toggleExtra = (id: HarnessSyncToolID, name: string, on: boolean) => {
    const current = toolPreset(draft.tools, id).skillExtras ?? []
    setDraft("tools", id, {
      ...toolPreset(draft.tools, id),
      skillExtras: on ? [...current, name] : current.filter((item) => item !== name),
    })
    const source = sourceOf(name)
    if (on && source && !library().some((skill) => skill.name === name)) setDraft("skillSources", name, source)
  }
  const discard = () => setDraft(reconcile(structuredClone(saved())))
  const save = () => {
    setBusy(true)
    void props.sync
      .save(withSkills(saved(), draft), props.status.document!.revision)
      .then((next) => {
        props.onStatus(next)
        setDraft(reconcile(structuredClone(presetsOf(next.document!))))
        showToast({ variant: "success", icon: "circle-check", title: t("harness.sync.savedToast") })
      })
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setBusy(false))
  }
  const nameOf = (id: HarnessSyncToolID) => props.status.tools.find((tool) => tool.id === id)?.name ?? id

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-3">
          <h4 class="type-section">{t("harness.sync.skills.shared")}</h4>
          <span class="type-meta text-v2-text-text-muted">{t("harness.sync.skills.shared.detail")}</span>
        </div>
        <Show
          when={draft.sharedSkills.length > 0}
          fallback={<div class="settings-v2-provider-empty">{t("harness.sync.skills.shared.empty")}</div>}
        >
          <SettingsListV2>
            <For each={draft.sharedSkills}>
              {(name) => (
                <SettingsRowV2 title={name} description={library().find((skill) => skill.name === name)?.description}>
                  <ButtonV2 size="small" variant="ghost" disabled={busy()} onClick={() => unshare(name)}>
                    {t("harness.sync.skills.unshare")}
                  </ButtonV2>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </Show>
      </div>

      <Show when={edited().length > 0}>
        <SettingsListV2>
          <For each={edited()}>
            {(copy) => (
              <div data-component="settings-v2-row" data-edited-skill={copy.name}>
                <HarnessIcon instance={logoInstance[copy.tool]} />
                <div data-slot="settings-v2-row-copy">
                  <span data-slot="settings-v2-row-title">{copy.name}</span>
                  <span data-slot="settings-v2-row-description" class="text-v2-state-fg-warning">
                    {t("harness.sync.skills.edited", { name: nameOf(copy.tool) })}
                  </span>
                </div>
                <ButtonV2
                  size="small"
                  variant="ghost"
                  aria-pressed={draft.skillSources[copy.name] === copy.tool}
                  disabled={busy()}
                  onClick={() => setDraft("skillSources", copy.name, copy.tool)}
                >
                  {t("harness.sync.skills.useThis")}
                </ButtonV2>
              </div>
            )}
          </For>
        </SettingsListV2>
      </Show>

      <div class="flex flex-col gap-2">
        <h4 class="type-section">{t("harness.sync.skills.modes")}</h4>
        <SettingsListV2>
          <For each={installed()}>
            {(tool) => {
              const preset = () => toolPreset(draft.tools, tool.id)
              const mode = () => preset().skillMode ?? "shared"
              return (
                <div class="flex flex-col" data-skill-mode={tool.id}>
                  <div data-component="settings-v2-row">
                    <HarnessIcon instance={logoInstance[tool.id]} />
                    <div data-slot="settings-v2-row-copy">
                      <span data-slot="settings-v2-row-title">{tool.name}</span>
                      <span data-slot="settings-v2-row-description">
                        {t(`harness.sync.skills.mode.${mode()}` as Key)}
                      </span>
                    </div>
                    <SegmentedControlV2
                      aria-label={t("harness.sync.mode.label", { name: tool.name })}
                      value={mode()}
                      onChange={(value) => value && setMode(tool.id, value as HarnessSyncMode)}
                    >
                      <For each={MODES}>
                        {(item) => (
                          <SegmentedControlItemV2 value={item}>
                            {t(`harness.sync.mode.${item}` as Key)}
                          </SegmentedControlItemV2>
                        )}
                      </For>
                    </SegmentedControlV2>
                  </div>
                  <Show when={(mode() === "append" || mode() === "custom") && extraOptions().length > 0}>
                    <div
                      class="flex flex-wrap gap-x-4 gap-y-2 px-4 pb-3 pl-11"
                      role="group"
                      aria-label={t("harness.sync.skills.extras", { name: tool.name })}
                    >
                      <For
                        each={extraOptions().filter(
                          (name) => mode() === "custom" || !draft.sharedSkills.includes(name),
                        )}
                      >
                        {(name) => (
                          <CheckboxV2
                            label={name}
                            checked={(preset().skillExtras ?? []).includes(name)}
                            onChange={(checked: boolean) => toggleExtra(tool.id, name, checked)}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </SettingsListV2>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-3">
          <h4 class="type-section">{t("harness.sync.skills.local")}</h4>
          <span class="type-meta text-v2-text-text-muted">{t("harness.sync.skills.local.detail")}</span>
        </div>
        <Show
          when={local().length > 0}
          fallback={<div class="settings-v2-provider-empty">{t("harness.sync.skills.local.empty")}</div>}
        >
          <SettingsListV2>
            <For each={local()}>
              {(skill) => (
                <div data-component="settings-v2-row" data-local-skill={skill.name}>
                  <HarnessIcon instance={logoInstance[skill.tool]} />
                  <div data-slot="settings-v2-row-copy">
                    <span data-slot="settings-v2-row-title">{skill.name}</span>
                    <span data-slot="settings-v2-row-description" class="line-clamp-2">
                      {skill.description ||
                        `${t("harness.sync.skills.from", { name: nameOf(skill.tool) })} · ${t("harness.sync.skills.files", { count: skill.files })}`}
                    </span>
                  </div>
                  <ButtonV2
                    size="small"
                    variant="ghost"
                    disabled={busy()}
                    onClick={() => share(skill.name, skill.tool)}
                  >
                    {t("harness.sync.skills.share")}
                  </ButtonV2>
                </div>
              )}
            </For>
          </SettingsListV2>
        </Show>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span
          class="flex-1 type-meta"
          classList={{ "text-v2-state-fg-warning": dirty(), "text-v2-text-text-muted": !dirty() }}
          role="status"
        >
          {dirty() ? t("harness.sync.unsaved") : t("harness.sync.saved")}
        </span>
        <ButtonV2 size="small" variant="ghost" disabled={!dirty() || busy()} onClick={discard}>
          {t("harness.sync.discard")}
        </ButtonV2>
        <ButtonV2
          size="small"
          variant="contrast"
          data-action="harness-sync-skills-save"
          disabled={!dirty() || busy()}
          onClick={save}
        >
          {t("harness.sync.save")}
        </ButtonV2>
      </div>
    </div>
  )
}
