import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Switch as ToggleSwitch } from "@tenon/ui/v2/switch-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { For, Show, createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useDrafts } from "@/context/drafts"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { parseProfileMarkdown } from "@/utils/model-profile"
import "./settings-v2.css"

/**
 * Settings → Model profiles: rules that counter a model's known mistakes, from the tor-model-profile skill. A
 * switched-on profile goes with a thread's first message, and again when the thread changes model, in every harness.
 */
export const SettingsModelProfilesV2: Component = () => {
  const language = useLanguage()
  const settings = useSettings()
  const drafts = useDrafts()
  const layout = useLayout()
  const server = useServer()
  const dialog = useDialog()
  const [state, setState] = createStore({ selected: "", adding: "", draft: "" })
  const models = createMemo(() =>
    Object.keys(settings.modelProfiles.all()).toSorted((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  )
  const selected = () => state.selected || models()[0] || ""
  const profile = () => settings.modelProfiles.all()[selected()]
  let file: HTMLInputElement | undefined

  const add = () => {
    const model = state.adding.trim()
    if (!model) return
    if (!settings.modelProfiles.all()[model]) settings.modelProfiles.set(model, { rules: "", enabled: true })
    setState({ selected: model, adding: "" })
  }
  const importFile = (picked: File | undefined) => {
    if (!picked) return
    void picked.text().then((text) => {
      const parsed = parseProfileMarkdown(text, state.adding || picked.name.replace(/\.md$/i, ""))
      if (!parsed.model) return
      settings.modelProfiles.set(parsed.model, {
        rules: parsed.rules,
        enabled: true,
        source: language.t("secondBrain.modelProfiles.imported", { file: picked.name }),
      })
      setState({ selected: parsed.model, adding: "" })
    })
  }
  // Benchmarks cost money, so this only opens a draft: nothing runs until the user sends it.
  const build = (model: string) => {
    const directory = layout.home.workspace()
    if (!directory) return
    dialog.close()
    void drafts.create(
      { server: server.key, directory },
      language.t("secondBrain.modelProfiles.buildPrompt", { model }),
    )
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.modelProfiles.title")}</h2>
      </div>
      <div class="settings-v2-tab-body flex flex-col gap-5">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("secondBrain.modelProfiles.intro")}</p>
        <div class="flex flex-wrap items-center gap-2">
          <TextInputV2
            type="text"
            class="min-w-[220px] flex-1"
            value={state.adding}
            placeholder={language.t("secondBrain.modelProfiles.modelPlaceholder")}
            aria-label={language.t("secondBrain.modelProfiles.model")}
            onInput={(event) => setState("adding", event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          <ButtonV2 variant="neutral" disabled={!state.adding.trim()} onClick={add}>
            {language.t("secondBrain.modelProfiles.add")}
          </ButtonV2>
          <ButtonV2 variant="ghost" onClick={() => file?.click()}>
            {language.t("secondBrain.modelProfiles.import")}
          </ButtonV2>
          <input
            ref={file}
            type="file"
            accept=".md,text/markdown,text/plain"
            class="hidden"
            onChange={(event) => {
              importFile(event.currentTarget.files?.[0])
              event.currentTarget.value = ""
            }}
          />
        </div>

        <Show
          when={models().length > 0}
          fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.modelProfiles.empty")}</div>}
        >
          <div class="flex min-h-0 gap-5">
            <ul
              class="flex w-[200px] shrink-0 flex-col gap-1"
              aria-label={language.t("secondBrain.modelProfiles.list")}
            >
              <For each={models()}>
                {(model) => {
                  const item = () => settings.modelProfiles.all()[model]
                  return (
                    <li>
                      <button
                        type="button"
                        aria-current={model === selected() ? "true" : undefined}
                        class="flex w-full flex-col items-start gap-0.5 rounded-[16px] px-3 py-2 text-left text-[13px] transition-colors duration-short ease-standard"
                        classList={{
                          "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container":
                            model === selected(),
                          "hover:bg-v2-overlay-simple-overlay-hover": model !== selected(),
                        }}
                        onClick={() => setState("selected", model)}
                      >
                        <span class="w-full truncate [font-weight:530]">{model}</span>
                        <span class="text-[12px] opacity-80">
                          {language.t(
                            item()?.enabled ? "secondBrain.modelProfiles.on" : "secondBrain.modelProfiles.off",
                          )}
                        </span>
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>

            <Show when={profile()}>
              {(current) => (
                <section class="flex min-w-0 flex-1 flex-col gap-3">
                  <div class="flex items-center gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[15px] text-v2-text-text-base [font-weight:560]">{selected()}</div>
                      <Show when={current().source}>
                        {(source) => <div class="text-[12px] text-v2-text-text-muted">{source()}</div>}
                      </Show>
                    </div>
                    <ToggleSwitch
                      checked={current().enabled}
                      onChange={(enabled) => settings.modelProfiles.set(selected(), { ...current(), enabled })}
                    >
                      {language.t("secondBrain.modelProfiles.active")}
                    </ToggleSwitch>
                  </div>
                  <TextareaV2
                    rows={12}
                    value={current().rules}
                    placeholder={language.t("secondBrain.modelProfiles.rulesPlaceholder")}
                    aria-label={language.t("secondBrain.modelProfiles.rules")}
                    onInput={(event) =>
                      settings.modelProfiles.set(selected(), { ...current(), rules: event.currentTarget.value })
                    }
                  />
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="flex-1 text-[12px] text-v2-text-text-muted">
                      {language.t("secondBrain.modelProfiles.applies")}
                    </span>
                    <ButtonV2 variant="ghost" onClick={() => settings.modelProfiles.remove(selected())}>
                      {language.t("common.delete")}
                    </ButtonV2>
                    <ButtonV2 variant="neutral" onClick={() => build(selected())}>
                      {language.t("secondBrain.modelProfiles.build")}
                    </ButtonV2>
                  </div>
                </section>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}
