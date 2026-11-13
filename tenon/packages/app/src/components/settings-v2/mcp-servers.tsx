import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { RevealShow } from "@tenon/ui/v2/reveal"
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
import { mcpEntry, mcpRows, mcpSuggestions, type McpSuggestion } from "./mcp-servers-model"
import "./settings-v2.css"

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Settings → MCP servers: the servers in the global config that every harness can use. Installed servers are a
 * list of settings rows with an on/off switch; below it, common servers are offered as rows that add in one click
 * (the row flies into the installed list). Custom server opens a form for a local command or a remote URL.
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
    /** The server just added, so only its row rises in. */
    added: "",
  })
  const rows = createMemo(() => mcpRows(serverSync().data.config.mcp))
  const suggestions = createMemo(() => mcpSuggestions(serverSync().data.config.mcp))
  let list: HTMLDivElement | undefined

  const save = (patch: Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0]) =>
    serverSync()
      .updateConfig(patch)
      .then(
        () => true,
        (error: unknown) => {
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
            description: error instanceof Error ? error.message : String(error),
          })
          return false
        },
      )

  const add = () => {
    const entry = mcpEntry(form.kind, form.target)
    const name = form.name.trim()
    if (!entry || !name || form.busy) return
    setForm({ busy: true, added: name })
    void save({ mcp: { [name]: entry } }).finally(() => setForm({ open: false, name: "", target: "", busy: false }))
  }

  // The suggested row flies into the installed list: a copy of it moves onto the new row while the list makes room.
  const addSuggestion = async (suggestion: McpSuggestion, item: HTMLElement) => {
    if (form.busy) return
    const from = item.getBoundingClientRect()
    const ghost = item.cloneNode(true)
    if (!(ghost instanceof HTMLElement)) return
    setForm({ busy: true, added: suggestion.id })
    const saved = await save({ mcp: { [suggestion.id]: suggestion.entry } })
    setForm("busy", false)
    if (!saved || reduced()) return
    requestAnimationFrame(() => {
      const row = list?.querySelector<HTMLElement>(`[data-mcp-row="${CSS.escape(suggestion.id)}"]`)
      if (!row) return
      const to = row.getBoundingClientRect()
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        margin: "0",
        zIndex: "100",
        // A row has no surface of its own; the copy borrows the list's.
        background: "var(--v2-background-bg-layer-01)",
        borderRadius: "var(--v2-radius-lg)",
        pointerEvents: "none",
        transformOrigin: "top left",
      })
      document.body.append(ghost)
      ghost
        .animate(
          [
            { transform: "none", opacity: 1 },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
              opacity: 0,
            },
          ],
          { duration: 420, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
        )
        .finished.finally(() => ghost.remove())
    })
  }

  return (
    <>
      <div class="settings-v2-tab-header flex items-center justify-between gap-3">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.mcp.title")}</h2>
        <ButtonV2 variant="neutral" icon="plus" onClick={() => setForm("open", (open) => !open)}>
          {language.t("secondBrain.mcp.custom")}
        </ButtonV2>
      </div>
      <div class="settings-v2-tab-body flex flex-col gap-5">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("secondBrain.mcp.intro")}</p>
        <RevealShow when={form.open}>
          {() => (
            <form
              class="flex flex-col gap-3 rounded-[24px] bg-v2-background-bg-layer-01 p-4"
              onSubmit={(event) => {
                event.preventDefault()
                add()
              }}
            >
              <div class="settings-v2-fit">
                <SegmentedControlV2
                  aria-label={language.t("secondBrain.mcp.kind")}
                  value={form.kind}
                  onChange={(value) => setForm("kind", value === "remote" ? "remote" : "local")}
                >
                  <SegmentedControlItemV2 value="local">{language.t("secondBrain.mcp.local")}</SegmentedControlItemV2>
                  <SegmentedControlItemV2 value="remote">{language.t("secondBrain.mcp.remote")}</SegmentedControlItemV2>
                </SegmentedControlV2>
              </div>
              <TextInputV2
                type="text"
                class="!w-full"
                value={form.name}
                placeholder={language.t("secondBrain.mcp.namePlaceholder")}
                aria-label={language.t("secondBrain.mcp.name")}
                onInput={(event) => setForm("name", event.currentTarget.value)}
              />
              <TextInputV2
                type="text"
                class="!w-full"
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
          )}
        </RevealShow>

        <section class="settings-v2-section" aria-labelledby="mcp-installed-title">
          <h3 id="mcp-installed-title" class="settings-v2-section-title">
            {language.t("secondBrain.mcp.installed")}
          </h3>
          <Show
            when={rows().length > 0}
            fallback={
              <SettingsListV2>
                <div class="settings-v2-provider-empty">{language.t("secondBrain.mcp.empty")}</div>
              </SettingsListV2>
            }
          >
            <div ref={list}>
              <SettingsListV2>
                <For each={rows()}>
                  {(row) => (
                    <div data-mcp-row={row.name} classList={{ "animate-enter": row.name === form.added }}>
                      <SettingsRowV2
                        title={row.name}
                        description={language.t(
                          row.entry.type === "local" ? "secondBrain.mcp.localDetail" : "secondBrain.mcp.remoteDetail",
                          { detail: row.detail },
                        )}
                      >
                        <ToggleSwitch
                          checked={row.enabled}
                          hideLabel
                          onChange={(enabled) => void save({ mcp: { [row.name]: { ...row.entry, enabled } } })}
                        >
                          {language.t("secondBrain.mcp.enabled", { name: row.name })}
                        </ToggleSwitch>
                      </SettingsRowV2>
                    </div>
                  )}
                </For>
              </SettingsListV2>
            </div>
            <p class="settings-v2-provider-description">{language.t("secondBrain.mcp.removeHint")}</p>
          </Show>
        </section>

        <Show when={suggestions().length > 0}>
          <section class="settings-v2-section" aria-labelledby="mcp-suggested-title">
            <h3 id="mcp-suggested-title" class="settings-v2-section-title">
              {language.t("secondBrain.mcp.suggested")}
            </h3>
            <SettingsListV2>
              <For each={suggestions()}>
                {(suggestion) => {
                  let item: HTMLDivElement | undefined
                  return (
                    <div ref={item}>
                      <SettingsRowV2
                        title={language.t(`secondBrain.mcp.suggest.${suggestion.id}.title`)}
                        description={
                          suggestion.signIn
                            ? language.t("secondBrain.mcp.withSignIn", {
                                body: language.t(`secondBrain.mcp.suggest.${suggestion.id}.body`),
                              })
                            : language.t(`secondBrain.mcp.suggest.${suggestion.id}.body`)
                        }
                      >
                        <ButtonV2
                          variant="neutral"
                          icon="plus"
                          disabled={form.busy}
                          onClick={() => item && void addSuggestion(suggestion, item)}
                        >
                          {language.t("secondBrain.mcp.addOne")}
                        </ButtonV2>
                      </SettingsRowV2>
                    </div>
                  )
                }}
              </For>
            </SettingsListV2>
          </section>
        </Show>
      </div>
    </>
  )
}
