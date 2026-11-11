import { Component, createMemo, createSignal, Show, startTransition } from "solid-js"
import { Dialog } from "@tenon/ui/v2/dialog-v2"
import { TabsV2 } from "@tenon/ui/v2/tabs-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneralV2 } from "./general"
import { SettingsKeybinds } from "../settings-keybinds"
import { SettingsProvidersV2 } from "./providers"
import { SettingsModelsV2 } from "./models"
import { SettingsHarnessesV2 } from "./harnesses"
import { SettingsSkillsV2 } from "./skills"
import { SettingsModelProfilesV2 } from "./model-profiles"
import { SettingsCalendarV2 } from "./calendar"
import { SettingsDictationV2 } from "./dictation"
import { SettingsCommandCentreV2 } from "./command-centre"
import { SettingsAccountsV2 } from "./accounts"
import { MicIcon } from "../prompt-input/dictation-button"
import "./settings-v2.css"
import { SettingsServersV2 } from "./servers"
import { useDialog } from "@tenon/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useDrafts } from "@/context/drafts"
import { useServerSync } from "@/context/server-sync"

export const DialogSettings: Component<{
  sessionID?: string
  defaultValue?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const drafts = useDrafts()
  const serverSync = useServerSync()
  // Providers and Models share the "Built-in harness" tab; their old tab names still open it on that part.
  const builtInPart = (value: string | undefined) => (value === "models" ? "models" : "providers")
  const [tab, setTab] = createSignal(
    props.defaultValue === "providers" || props.defaultValue === "models"
      ? "built-in"
      : (props.defaultValue ?? "general"),
  )
  const [builtIn, setBuiltIn] = createSignal(builtInPart(props.defaultValue))
  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "draft") return drafts.get(route.draftID)?.directory
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return undefined
  })

  const showProviders = () => {
    void dialog.show(() => <DialogSettings sessionID={props.sessionID} defaultValue="providers" />)
  }

  const showHarnesses = () => {
    void dialog.show(() => <DialogSettings sessionID={props.sessionID} defaultValue="harnesses" />)
  }

  return (
    <Dialog size="x-large" variant="settings" class="settings-v2-dialog relative">
      <IconButtonV2
        type="button"
        variant="ghost-muted"
        class="absolute right-3 top-3 z-10"
        aria-label={language.t("common.close")}
        icon={<Icon name="close" size="small" />}
        onClick={() => dialog.close()}
      />
      <TabsV2
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="settings-v2"
      >
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full">
              <div class="flex flex-col gap-6">
                <div class="flex flex-col gap-1">
                  <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1 w-full">
                    <TabsV2.Trigger value="general">
                      <Icon name="outline-sliders" />
                      {language.t("settings.tab.general")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="calendar">
                      <Icon name="calendar" />
                      {language.t("secondBrain.settings.tab.calendar")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="dictation">
                      <MicIcon />
                      {language.t("dictation.settings.tab")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="command-centre">
                      <Icon name="console" />
                      {language.t("secondBrain.commandCentre.settings.tab")}
                    </TabsV2.Trigger>
                    <Show when={platform.mail}>
                      <TabsV2.Trigger value="accounts">
                        <Icon name="link" />
                        {language.t("secondBrain.mail.settings.tab")}
                      </TabsV2.Trigger>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-col gap-1">
                  <TabsV2.SectionTitle>{language.t("settings.section.server")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1 w-full">
                    <TabsV2.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="built-in">
                      <Icon name="models" />
                      {language.t("secondBrain.settings.tab.builtInHarness")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="harnesses">
                      <Icon name="terminal" />
                      {language.t("harness.settings.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="skills">
                      <Icon name="book" />
                      {language.t("secondBrain.skills.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="model-profiles">
                      <Icon name="pencil-line" />
                      {language.t("secondBrain.modelProfiles.title")}
                    </TabsV2.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="settings-v2-nav-footer">
              <span>{language.t("app.name.desktop")}</span>
              <span>v{platform.version}</span>
            </div>
          </div>
        </TabsV2.List>
        <TabsV2.Content value="general" class="settings-v2-panel">
          <SettingsGeneralV2 sessionID={props.sessionID} />
        </TabsV2.Content>
        <TabsV2.Content value="shortcuts" class="settings-v2-panel">
          <SettingsKeybinds />
        </TabsV2.Content>
        <TabsV2.Content value="calendar" class="settings-v2-panel">
          <SettingsCalendarV2 />
        </TabsV2.Content>
        <TabsV2.Content value="dictation" class="settings-v2-panel">
          <SettingsDictationV2 />
        </TabsV2.Content>
        <TabsV2.Content value="command-centre" class="settings-v2-panel">
          <SettingsCommandCentreV2 />
        </TabsV2.Content>
        <Show when={platform.mail}>
          <TabsV2.Content value="accounts" class="settings-v2-panel">
            <SettingsAccountsV2 />
          </TabsV2.Content>
        </Show>
        <TabsV2.Content value="servers" class="settings-v2-panel">
          <SettingsServersV2 />
        </TabsV2.Content>
        <TabsV2.Content value="built-in" class="settings-v2-panel">
          {/* Tenon's own agent: the providers it can call, then which of their models the pickers show. */}
          <div class="settings-v2-subtabs">
            <SegmentedControlV2
              aria-label={language.t("secondBrain.settings.tab.builtInHarness")}
              value={builtIn()}
              onChange={(value) => setBuiltIn(builtInPart(value ?? undefined))}
            >
              <SegmentedControlItemV2 value="providers">
                {language.t("settings.providers.title")}
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="models">{language.t("settings.models.title")}</SegmentedControlItemV2>
            </SegmentedControlV2>
          </div>
          <Show when={builtIn() === "providers"} fallback={<SettingsModelsV2 />}>
            <SettingsProvidersV2 directory={directory} onBack={showProviders} />
          </Show>
        </TabsV2.Content>
        <TabsV2.Content value="harnesses" class="settings-v2-panel">
          <SettingsHarnessesV2 directory={directory} onBack={showHarnesses} />
        </TabsV2.Content>
        <TabsV2.Content value="skills" class="settings-v2-panel">
          <SettingsSkillsV2 directory={directory} />
        </TabsV2.Content>
        <TabsV2.Content value="model-profiles" class="settings-v2-panel">
          <SettingsModelProfilesV2 />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}
