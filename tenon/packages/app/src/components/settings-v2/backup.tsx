import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { CheckboxV2 } from "@tenon/ui/v2/checkbox-v2"
import { For, Show } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import {
  backupFileName,
  blankedSecrets,
  exportSettings,
  mergeSettings,
  parseSettingsBackup,
  type BackupSection,
  type SettingsBackup,
} from "@/features/settings-backup/backup"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

const importedServers = (mcp: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(mcp).map(([name, entry]) => [
      name,
      typeof entry === "object" && entry !== null ? { ...entry, enabled: false } : entry,
    ]),
  )

export function SettingsBackupV2() {
  const language = useLanguage()
  const settings = useSettings()
  const serverSync = useServerSync()
  const [state, setState] = createStore({
    file: undefined as SettingsBackup | undefined,
    sections: [] as BackupSection[],
    chosen: [] as BackupSection[],
    error: "",
    applying: false,
  })
  let picker: HTMLInputElement | undefined

  const download = () => {
    const now = new Date()
    const file = exportSettings({
      settings: unwrap(settings.current),
      mcp: serverSync().data.config.mcp,
      now,
    })
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = backupFileName(now)
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  const choose = async (input: HTMLInputElement) => {
    const picked = input.files?.[0]
    input.value = ""
    if (!picked) return
    const parsed = parseSettingsBackup(await picked.text().catch(() => ""))
    if (!parsed.ok)
      return setState({ file: undefined, sections: [], chosen: [], error: language.t("secondBrain.backup.invalid") })
    setState({ file: parsed.file, sections: parsed.sections, chosen: parsed.sections, error: "" })
  }

  const apply = async () => {
    const file = state.file
    if (!file || state.applying) return
    setState("applying", true)
    settings.restore(mergeSettings(unwrap(settings.current), file, state.chosen))
    const mcp = state.chosen.includes("mcp")
      ? await serverSync()
          .updateConfig({ mcp: { ...serverSync().data.config.mcp, ...importedServers(file.mcp) } } as never)
          .then(
            () => true,
            () => false,
          )
      : true
    setState({ applying: false, file: undefined, sections: [], chosen: [] })
    showToast({
      variant: mcp ? undefined : "error",
      title: language.t(mcp ? "secondBrain.backup.applied" : "secondBrain.backup.mcpFailed"),
    })
  }

  const label = (section: BackupSection) => language.t(`secondBrain.backup.section.${section}`)

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.backup.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="backup-settings">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("secondBrain.backup.export")}
              description={language.t("secondBrain.backup.export.description")}
            >
              <ButtonV2 size="small" variant="tonal" onClick={download}>
                {language.t("secondBrain.backup.export.action")}
              </ButtonV2>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("secondBrain.backup.import")}
              description={language.t("secondBrain.backup.import.description")}
            >
              <ButtonV2 size="small" variant="tonal" onClick={() => picker?.click()}>
                {language.t("secondBrain.backup.import.action")}
              </ButtonV2>
              <input
                ref={picker}
                type="file"
                accept="application/json,.json"
                class="hidden"
                onChange={(event) => void choose(event.currentTarget)}
              />
            </SettingsRowV2>
          </SettingsListV2>
          <Show when={state.error}>
            <div class="settings-v2-provider-empty" role="alert">
              {state.error}
            </div>
          </Show>
        </div>
        <Show when={state.file}>
          {(file) => (
            <div class="settings-v2-section">
              <h4 class="settings-v2-section-title">
                {language.t("secondBrain.backup.choose", {
                  date: file().exportedAt ? new Date(file().exportedAt).toLocaleString(language.intl()) : "—",
                })}
              </h4>
              <div class="flex flex-col gap-2 px-1">
                <For each={state.sections}>
                  {(section) => (
                    <CheckboxV2
                      checked={state.chosen.includes(section)}
                      label={label(section)}
                      onChange={(value: boolean) =>
                        setState("chosen", (list) =>
                          value
                            ? [...list.filter((item) => item !== section), section]
                            : list.filter((item) => item !== section),
                        )
                      }
                    />
                  )}
                </For>
              </div>
              <Show when={blankedSecrets(file()).length > 0}>
                <p class="type-meta text-v2-text-text-muted">
                  {language.t("secondBrain.backup.secrets", { servers: blankedSecrets(file()).join(", ") })}
                </p>
              </Show>
              <div class="flex gap-2">
                <ButtonV2
                  size="small"
                  variant="contrast"
                  disabled={state.applying || state.chosen.length === 0}
                  onClick={() => void apply()}
                >
                  {language.t("secondBrain.backup.apply")}
                </ButtonV2>
                <ButtonV2
                  size="small"
                  variant="ghost"
                  onClick={() => setState({ file: undefined, sections: [], chosen: [] })}
                >
                  {language.t("common.cancel")}
                </ButtonV2>
              </div>
            </div>
          )}
        </Show>
      </div>
    </>
  )
}
