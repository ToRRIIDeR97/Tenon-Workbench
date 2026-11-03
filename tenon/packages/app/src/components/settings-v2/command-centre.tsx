import { SelectV2 } from "@tenon/ui/v2/select-v2"
import { Harness } from "@tenon/schema/harness"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { memoryDays, useSettings } from "@/context/settings"
import { listHarnessesForServer } from "@/utils/server"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

/** Settings › Command Centre: the harness and model its threads start with, and how long threads are kept. */
export function SettingsCommandCentreV2() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const settings = useSettings()
  const current = () => settings.commandCentre.current()
  // The age the panel opened with; a lower value warns that more threads will go.
  const [saved] = createSignal(current().memoryDays)
  const [draft, setDraft] = createSignal(String(current().memoryDays))
  // Harness settings are global; the route only needs some valid location.
  const directory = () =>
    layout.home.workspace() || layout.projects.list()[0]?.worktree || serverSync().data.path.home || undefined
  const [instances] = createResource(directory, (dir) =>
    listHarnessesForServer({ server: serverSDK().server.http, fetch: platform.fetch }, dir).catch(() => []),
  )
  const harnessID = () => current().harnessID ?? Harness.OpenCode
  const harnessOptions = createMemo(() => [
    { value: Harness.OpenCode as string, label: language.t("harness.settings.defaults.builtIn") },
    ...(instances.latest ?? [])
      .filter((instance) => instance.id !== Harness.OpenCode)
      .map((instance) => ({ value: instance.id, label: instance.name })),
  ])
  const modelOptions = createMemo(() => [
    { value: "", label: language.t("harness.settings.defaults.modelDefault") },
    ...((instances.latest ?? []).find((instance) => instance.id === harnessID())?.models ?? []).map((model) => ({
      value: model.id,
      label: model.name,
    })),
  ])
  const lowered = () => {
    const value = Number(draft())
    return Number.isFinite(value) && draft().trim() !== "" && value < saved()
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.commandCentre.settings.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="command-centre-settings">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("secondBrain.commandCentre.settings.harness")}
              description={language.t("secondBrain.commandCentre.settings.harness.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="command-centre-harness"
                options={harnessOptions()}
                current={harnessOptions().find((option) => option.value === harnessID()) ?? harnessOptions()[0]}
                placement="bottom-end"
                gutter={6}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) =>
                  option &&
                  settings.commandCentre.set({
                    harnessID: option.value === Harness.OpenCode ? undefined : option.value,
                    modelID: undefined,
                  })
                }
              />
            </SettingsRowV2>
            <Show when={modelOptions().length > 1}>
              <SettingsRowV2
                title={language.t("secondBrain.commandCentre.settings.model")}
                description={language.t("secondBrain.commandCentre.settings.model.description")}
              >
                <SelectV2
                  appearance="inline"
                  data-action="command-centre-model"
                  options={modelOptions()}
                  current={
                    modelOptions().find((option) => option.value === (current().modelID ?? "")) ?? modelOptions()[0]
                  }
                  placement="bottom-end"
                  gutter={6}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  onSelect={(option) => option && settings.commandCentre.set({ modelID: option.value || undefined })}
                />
              </SettingsRowV2>
            </Show>
            <SettingsRowV2
              title={language.t("secondBrain.commandCentre.settings.memoryDays")}
              description={language.t("secondBrain.commandCentre.settings.memoryDays.description")}
            >
              <input
                type="number"
                min="1"
                max="365"
                step="1"
                class="h-8 w-20 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-right text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
                aria-label={language.t("secondBrain.commandCentre.settings.memoryDays")}
                value={draft()}
                // Typing only updates the draft (and the lowering warning); the value saves, clamped to 1–365,
                // when the field commits (Enter, the stepper or leaving it), so "3" on the way to "30" never saves.
                onInput={(event) => setDraft(event.currentTarget.value)}
                onChange={(event) => {
                  if (event.currentTarget.value.trim() === "") return setDraft(String(current().memoryDays))
                  const days = memoryDays(event.currentTarget.value)
                  settings.commandCentre.set({ memoryDays: days })
                  setDraft(String(days))
                }}
                onBlur={() => setDraft(String(current().memoryDays))}
              />
            </SettingsRowV2>
          </SettingsListV2>
          <Show when={lowered()}>
            <p role="status" class="text-12-regular text-text-critical">
              {language.t("secondBrain.commandCentre.settings.memoryDays.warning")}
            </p>
          </Show>
        </div>
      </div>
    </>
  )
}
