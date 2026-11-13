import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { Reveal } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { Switch as ToggleSwitch } from "@tenon/ui/v2/switch-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { TextareaV2 } from "@tenon/ui/v2/textarea-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { For, Show, createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useDrafts } from "@/context/drafts"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useModels } from "@/context/models"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import {
  appendProfileRule,
  parseProfileMarkdown,
  profileModelMatches,
  profileRules,
  removeProfileRule,
  type ModelProfile,
} from "@/utils/model-profile"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type View = "rules" | "markdown"

/**
 * Settings → Model profiles: rules that counter a model's known mistakes, from the tor-model-profile skill. A
 * switched-on profile goes with a thread's first message, and again when the thread changes model, in every harness.
 * Profiles are folding rows like Settings → Harnesses: the model, its rule count and its switch; an open row shows
 * its rules as rows (Rules) or its profile.md to edit as Markdown, behind the same switch Built-in harness uses.
 */
export const SettingsModelProfilesV2: Component = () => {
  const language = useLanguage()
  const settings = useSettings()
  const drafts = useDrafts()
  const layout = useLayout()
  const server = useServer()
  const dialog = useDialog()
  const catalog = useModels()
  const [state, setState] = createStore({
    open: "",
    view: "rules" as View,
    adding: false,
    model: "",
    rule: "",
  })
  const models = createMemo(() =>
    Object.keys(settings.modelProfiles.all()).toSorted((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  )
  const update = (model: string, patch: Partial<ModelProfile>) => {
    const current = settings.modelProfiles.all()[model]
    if (current) settings.modelProfiles.set(model, { ...current, ...patch })
  }
  let file: HTMLInputElement | undefined
  let search: HTMLInputElement | undefined

  // Add profile searches the models you have; a typed id that matches none can still be added as it is.
  const matches = createMemo(() => profileModelMatches(catalog.list(), state.model, models()))
  const add = (id = state.model.trim()) => {
    if (!id) return
    if (!settings.modelProfiles.all()[id]) settings.modelProfiles.set(id, { rules: "", enabled: true })
    setState({ open: id, view: "rules", adding: false, model: "" })
  }
  const importFile = (picked: File | undefined) => {
    if (!picked) return
    void picked.text().then((text) => {
      const parsed = parseProfileMarkdown(text, picked.name.replace(/\.md$/i, ""))
      if (!parsed.model) return
      settings.modelProfiles.set(parsed.model, {
        rules: parsed.rules,
        enabled: true,
        source: language.t("secondBrain.modelProfiles.imported", { file: picked.name }),
      })
      setState({ open: parsed.model, view: "rules" })
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
  const addRule = (model: string) => {
    const current = settings.modelProfiles.all()[model]
    if (!current || !state.rule.trim()) return
    update(model, { rules: appendProfileRule(current.rules, state.rule) })
    setState("rule", "")
  }

  return (
    <>
      <div class="settings-v2-tab-header flex items-center justify-between gap-3">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.modelProfiles.title")}</h2>
        <div class="flex items-center gap-2">
          <ButtonV2 variant="ghost" onClick={() => file?.click()}>
            {language.t("secondBrain.modelProfiles.import")}
          </ButtonV2>
          <ButtonV2
            variant="neutral"
            icon="plus"
            onClick={() => {
              setState({ adding: !state.adding, model: "" })
              if (state.adding) requestAnimationFrame(() => search?.focus())
            }}
          >
            {language.t("secondBrain.modelProfiles.add")}
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
      </div>
      <div class="settings-v2-tab-body flex flex-col gap-5">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("secondBrain.modelProfiles.intro")}</p>
        <Reveal open={state.adding}>
          <div class="flex flex-col gap-2">
            <form
              class="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                add(matches()[0]?.id)
              }}
            >
              <TextInputV2
                type="search"
                class="min-w-[220px] flex-1"
                value={state.model}
                ref={(element) => (search = element)}
                placeholder={language.t("secondBrain.modelProfiles.search")}
                aria-label={language.t("secondBrain.modelProfiles.model")}
                onInput={(event) => setState("model", event.currentTarget.value)}
                onKeyDown={(event) =>
                  event.key === "Escape" && (event.stopPropagation(), setState({ adding: false, model: "" }))
                }
              />
              <ButtonV2 type="button" variant="ghost" onClick={() => setState({ adding: false, model: "" })}>
                {language.t("common.cancel")}
              </ButtonV2>
            </form>
            <SettingsListV2>
              <For each={matches()}>
                {(model) => (
                  <SettingsRowV2 title={model.name} description={`${model.provider.name} · ${model.id}`}>
                    <ButtonV2 variant="neutral" icon="plus" onClick={() => add(model.id)}>
                      {language.t("secondBrain.modelProfiles.create")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </For>
              <Show when={state.model.trim() && !matches().some((model) => model.id === state.model.trim())}>
                <SettingsRowV2
                  title={language.t("secondBrain.modelProfiles.addTyped", { model: state.model.trim() })}
                  description={language.t("secondBrain.modelProfiles.addTypedHint")}
                >
                  <ButtonV2 variant="ghost" icon="plus" onClick={() => add()}>
                    {language.t("secondBrain.modelProfiles.create")}
                  </ButtonV2>
                </SettingsRowV2>
              </Show>
            </SettingsListV2>
          </div>
        </Reveal>

        <section class="settings-v2-section" aria-labelledby="model-profiles-list-title">
          <h3 id="model-profiles-list-title" class="settings-v2-section-title">
            {language.t("secondBrain.modelProfiles.list")}
          </h3>
          <SettingsListV2>
            <Show
              when={models().length > 0}
              fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.modelProfiles.empty")}</div>}
            >
              <For each={models()}>
                {(model) => {
                  const profile = () => settings.modelProfiles.all()[model]
                  const rules = () => profileRules(profile()?.rules ?? "")
                  const open = () => state.open === model
                  return (
                    <div class="settings-v2-harness-group" data-model-profile={model}>
                      <div class="settings-v2-harness-group-row">
                        <button
                          type="button"
                          class="settings-v2-harness-group-toggle"
                          aria-expanded={open()}
                          onClick={() => setState({ open: open() ? "" : model, view: "rules", rule: "" })}
                        >
                          <Icon name="chevron-down" class="settings-v2-harness-group-chevron" />
                          <span
                            class="settings-v2-provider-name truncate"
                            classList={{ "opacity-50": !profile()?.enabled }}
                          >
                            {model}
                          </span>
                          <span class="settings-v2-provider-description shrink-0">
                            {rules().length > 0
                              ? language.plural("secondBrain.modelProfiles.ruleCount", rules().length, {
                                  count: rules().length,
                                })
                              : language.t("secondBrain.modelProfiles.noRules")}
                          </span>
                        </button>
                        <ToggleSwitch
                          checked={profile()?.enabled ?? false}
                          hideLabel
                          onChange={(enabled) => update(model, { enabled })}
                        >
                          {language.t("secondBrain.modelProfiles.enabled", { model })}
                        </ToggleSwitch>
                      </div>
                      <Reveal open={open()}>
                        <div class="flex flex-col gap-3 pb-4 pl-9 pr-4 pt-1">
                          <div class="settings-v2-fit flex items-center gap-3">
                            <SegmentedControlV2
                              aria-label={language.t("secondBrain.modelProfiles.view")}
                              value={state.view}
                              onChange={(value) => setState("view", value === "markdown" ? "markdown" : "rules")}
                            >
                              <SegmentedControlItemV2 value="rules">
                                {language.t("secondBrain.modelProfiles.rules")}
                              </SegmentedControlItemV2>
                              <SegmentedControlItemV2 value="markdown">profile.md</SegmentedControlItemV2>
                            </SegmentedControlV2>
                            <Show when={profile()?.source}>
                              {(source) => <span class="settings-v2-provider-description truncate">{source()}</span>}
                            </Show>
                          </div>
                          <Show
                            when={state.view === "rules"}
                            fallback={
                              <TextareaV2
                                class="!w-full animate-enter"
                                rows={10}
                                value={profile()?.rules ?? ""}
                                placeholder={language.t("secondBrain.modelProfiles.rulesPlaceholder")}
                                aria-label={language.t("secondBrain.modelProfiles.markdown", { model })}
                                onInput={(event) => update(model, { rules: event.currentTarget.value })}
                              />
                            }
                          >
                            <div class="animate-enter">
                              <SettingsListV2>
                                <For each={rules()}>
                                  {(rule) => (
                                    <SettingsRowV2 title={rule.text}>
                                      <IconButtonV2
                                        type="button"
                                        variant="ghost-muted"
                                        size="small"
                                        aria-label={language.t("secondBrain.modelProfiles.removeRule", {
                                          rule: rule.text,
                                        })}
                                        icon={<Icon name="close" size="small" />}
                                        onClick={() =>
                                          update(model, {
                                            rules: removeProfileRule(profile()?.rules ?? "", rule.index),
                                          })
                                        }
                                      />
                                    </SettingsRowV2>
                                  )}
                                </For>
                                <form
                                  class="flex px-4 py-3"
                                  onSubmit={(event) => {
                                    event.preventDefault()
                                    addRule(model)
                                  }}
                                >
                                  <TextInputV2
                                    type="text"
                                    class="!w-full"
                                    value={state.rule}
                                    placeholder={language.t("secondBrain.modelProfiles.addRule")}
                                    aria-label={language.t("secondBrain.modelProfiles.addRule")}
                                    onInput={(event) => setState("rule", event.currentTarget.value)}
                                  />
                                </form>
                              </SettingsListV2>
                            </div>
                          </Show>
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="settings-v2-provider-description flex-1">
                              {language.t("secondBrain.modelProfiles.applies")}
                            </span>
                            <ButtonV2 variant="ghost" onClick={() => settings.modelProfiles.remove(model)}>
                              {language.t("common.delete")}
                            </ButtonV2>
                            <ButtonV2 variant="neutral" onClick={() => build(model)}>
                              {language.t("secondBrain.modelProfiles.build")}
                            </ButtonV2>
                          </div>
                        </div>
                      </Reveal>
                    </div>
                  )
                }}
              </For>
            </Show>
          </SettingsListV2>
        </section>
      </div>
    </>
  )
}
