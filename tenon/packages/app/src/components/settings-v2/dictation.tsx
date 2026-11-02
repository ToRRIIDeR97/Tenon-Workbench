import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { For, Show, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type DictationModelID } from "@/context/platform"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

const HANDY_URL = "https://github.com/cjpais/Handy"

export function SettingsDictationV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, { refetch }] = createResource(() => platform.dictation?.models())
  const [view, setView] = createStore({
    progress: {} as Partial<Record<DictationModelID, number>>,
    failed: undefined as DictationModelID | undefined,
  })
  const offProgress = platform.dictation?.onDownloadProgress((progress) =>
    setView("progress", progress.id, Math.floor((progress.received / progress.total) * 100)),
  )
  onCleanup(() => offProgress?.())

  const download = async (id: DictationModelID) => {
    const dictation = platform.dictation
    if (!dictation) return
    setView({ failed: undefined })
    setView("progress", id, 0)
    await dictation.download(id).catch(() => setView({ failed: id }))
    setView("progress", id, undefined)
    void refetch()
  }
  const use = async (id: DictationModelID) => {
    await platform.dictation?.setActive(id)
    void refetch()
  }
  const remove = async (id: DictationModelID) => {
    await platform.dictation?.remove(id)
    void refetch()
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("dictation.settings.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="dictation-settings">
        <Show
          when={platform.dictation}
          fallback={<div class="settings-v2-provider-empty">{language.t("dictation.settings.desktopOnly")}</div>}
        >
          <div class="settings-v2-section">
            <h4 class="settings-v2-section-title">{language.t("dictation.settings.models")}</h4>
            <p class="text-12-regular text-text-weak">{language.t("dictation.settings.description")}</p>
            <SettingsListV2>
              <For each={state.latest?.models ?? []}>
                {(model) => {
                  const downloading = () => view.progress[model.id] !== undefined
                  const active = () => state.latest?.active === model.id && model.downloaded
                  return (
                    <SettingsRowV2
                      title={model.name}
                      description={
                        <>
                          {language.t(`dictation.settings.model.${model.id}` as Parameters<typeof language.t>[0])}
                          {" · "}
                          {language.t("dictation.settings.size", { size: Math.round(model.size / 1_000_000) })}
                        </>
                      }
                    >
                      <div class="flex items-center gap-2" data-model={model.id}>
                        <Show when={view.failed === model.id}>
                          <span class="text-12-regular text-text-critical" role="alert">
                            {language.t("dictation.settings.downloadFailed")}
                          </span>
                        </Show>
                        <Show
                          when={model.downloaded}
                          fallback={
                            <ButtonV2
                              size="small"
                              variant="tonal"
                              data-action="dictation-download"
                              disabled={downloading()}
                              onClick={() => void download(model.id)}
                            >
                              {downloading()
                                ? language.t("dictation.settings.downloading", {
                                    percent: view.progress[model.id] ?? 0,
                                  })
                                : language.t("dictation.settings.download")}
                            </ButtonV2>
                          }
                        >
                          <ButtonV2
                            size="small"
                            variant="ghost"
                            data-action="dictation-remove"
                            disabled={active()}
                            onClick={() => void remove(model.id)}
                          >
                            {language.t("dictation.settings.remove")}
                          </ButtonV2>
                          <ButtonV2
                            size="small"
                            variant="tonal"
                            data-action="dictation-use"
                            aria-pressed={active()}
                            disabled={active()}
                            onClick={() => void use(model.id)}
                          >
                            {active() ? language.t("dictation.settings.active") : language.t("dictation.settings.use")}
                          </ButtonV2>
                        </Show>
                      </div>
                    </SettingsRowV2>
                  )
                }}
              </For>
            </SettingsListV2>
            <Show when={state.latest?.folder}>
              {(folder) => (
                <p class="text-12-regular text-text-weak">
                  {language.t("dictation.settings.folder", { folder: folder() })}
                </p>
              )}
            </Show>
          </div>
        </Show>
        <div class="settings-v2-section">
          <a
            class="text-12-regular text-text-weak underline"
            href={HANDY_URL}
            data-action="dictation-credit"
            onClick={(event) => {
              event.preventDefault()
              platform.openExternal(HANDY_URL)
            }}
          >
            {language.t("dictation.settings.credit")}
          </a>
        </div>
      </div>
    </>
  )
}
