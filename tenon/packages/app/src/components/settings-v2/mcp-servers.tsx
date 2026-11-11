import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { Switch as ToggleSwitch } from "@tenon/ui/v2/switch-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { For, Show, createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { mcpEntry, mcpRows } from "./mcp-servers-model"
import "./settings-v2.css"

/**
 * Settings → MCP servers: the servers in the global config that the built-in agent connects to. Adding writes a
 * local command or a remote URL; the switch turns one off without losing it. External harnesses keep their own
 * MCP settings and get Tenon's own server for delegation and app tools.
 */
export const SettingsMcpServersV2: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const [form, setForm] = createStore({
    open: false,
    name: "",
    kind: "local" as "local" | "remote",
    target: "",
    busy: false,
  })
  const rows = createMemo(() => mcpRows(serverSync().data.config.mcp))

  const save = (patch: Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0]) =>
    serverSync()
      .updateConfig(patch)
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )

  const add = () => {
    const entry = mcpEntry(form.kind, form.target)
    const name = form.name.trim()
    if (!entry || !name || form.busy) return
    setForm("busy", true)
    void save({ mcp: { [name]: entry } }).finally(() => setForm({ open: false, name: "", target: "", busy: false }))
  }

  return (
    <>
      <div class="settings-v2-tab-header flex items-center justify-between gap-3">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.mcp.title")}</h2>
        <ButtonV2 variant="neutral" onClick={() => setForm("open", (open) => !open)}>
          {language.t("secondBrain.mcp.add")}
        </ButtonV2>
      </div>
      <div class="settings-v2-tab-body flex flex-col gap-4">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("secondBrain.mcp.intro")}</p>
        <Show when={form.open}>
          <form
            class="flex flex-col gap-3 rounded-[24px] bg-v2-background-bg-layer-01 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              add()
            }}
          >
            <SegmentedControlV2
              class="w-fit"
              aria-label={language.t("secondBrain.mcp.kind")}
              value={form.kind}
              onChange={(value) => setForm("kind", value === "remote" ? "remote" : "local")}
            >
              <SegmentedControlItemV2 value="local">{language.t("secondBrain.mcp.local")}</SegmentedControlItemV2>
              <SegmentedControlItemV2 value="remote">{language.t("secondBrain.mcp.remote")}</SegmentedControlItemV2>
            </SegmentedControlV2>
            <TextInputV2
              type="text"
              value={form.name}
              placeholder={language.t("secondBrain.mcp.namePlaceholder")}
              aria-label={language.t("secondBrain.mcp.name")}
              onInput={(event) => setForm("name", event.currentTarget.value)}
            />
            <TextInputV2
              type="text"
              value={form.target}
              placeholder={language.t(
                form.kind === "local" ? "secondBrain.mcp.commandPlaceholder" : "secondBrain.mcp.urlPlaceholder",
              )}
              aria-label={language.t(form.kind === "local" ? "secondBrain.mcp.command" : "secondBrain.mcp.url")}
              onInput={(event) => setForm("target", event.currentTarget.value)}
            />
            <div class="flex justify-end gap-2">
              <ButtonV2 type="button" variant="ghost" onClick={() => setForm("open", false)}>
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2
                type="submit"
                variant="contrast"
                disabled={form.busy || !form.name.trim() || !mcpEntry(form.kind, form.target)}
              >
                {language.t("common.save")}
              </ButtonV2>
            </div>
          </form>
        </Show>
        <Show
          when={rows().length > 0}
          fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.mcp.empty")}</div>}
        >
          <SettingsListV2>
            <For each={rows()}>
              {(row) => (
                <SettingsRowV2 title={row.name} description={row.detail}>
                  <ToggleSwitch
                    checked={row.enabled}
                    hideLabel
                    onChange={(enabled) => void save({ mcp: { [row.name]: { ...row.entry, enabled } } })}
                  >
                    {language.t("secondBrain.mcp.enabled", { name: row.name })}
                  </ToggleSwitch>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
          <p class="text-[12px] text-v2-text-text-muted">{language.t("secondBrain.mcp.removeHint")}</p>
        </Show>
      </div>
    </>
  )
}
