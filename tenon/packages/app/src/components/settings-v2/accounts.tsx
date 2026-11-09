import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type MailAccount } from "@/context/platform"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

const inputClass =
  "h-8 min-w-0 rounded-full bg-v2-background-bg-layer-01 px-3 text-[13px] font-[450] leading-5 text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] outline-none transition-shadow duration-short ease-standard hover:shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)] focus:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"

/** Settings › Accounts (desktop): the mail accounts the Command Centre reads and drafts in. */
export function SettingsAccountsV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const [available] = createResource(
    () => platform.mail,
    (mail) => mail.available(),
  )
  const [accounts, { mutate }] = createResource(
    () => platform.mail,
    (mail) => mail.accounts(),
  )
  const [state, setState] = createStore({
    busy: "",
    failed: false,
    imap: false,
    form: { host: "", port: "993", secure: true, user: "", password: "", address: "" },
  })
  const providerName = (provider: MailAccount["provider"]) =>
    language.t(`secondBrain.mail.provider.${provider}` as Parameters<typeof language.t>[0])

  const run = async (busy: string, action: () => Promise<MailAccount[]> | undefined) => {
    setState({ busy, failed: false })
    try {
      const next = await action()
      if (next) mutate(next)
      return true
    } catch {
      setState("failed", true)
      return false
    } finally {
      setState("busy", "")
    }
  }
  const addImap = async () => {
    const form = state.form
    const saved = await run("imap", () =>
      platform.mail?.addImap({
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        user: form.user,
        password: form.password,
        address: form.address || undefined,
      }),
    )
    if (saved)
      setState({ imap: false, form: { host: "", port: "993", secure: true, user: "", password: "", address: "" } })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.mail.settings.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="mail-accounts-settings">
        <Show
          when={platform.mail}
          fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.mail.settings.desktopOnly")}</div>}
        >
          <div class="settings-v2-section">
            <div class="flex flex-col gap-1">
              <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.mail.settings.description")}</p>
              <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.mail.settings.draftOnly")}</p>
            </div>
            <Show when={available.latest && !available.latest.secureStorage}>
              <p role="alert" class="type-meta text-v2-text-text-critical">
                {language.t("secondBrain.mail.settings.secureStorage")}
              </p>
            </Show>
            <SettingsListV2>
              <For
                each={accounts.latest ?? []}
                fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.mail.settings.empty")}</div>}
              >
                {(account) => (
                  <SettingsRowV2 title={account.address} description={providerName(account.provider)}>
                    <ButtonV2
                      size="small"
                      variant="ghost"
                      data-action="mail-remove"
                      disabled={state.busy !== ""}
                      onClick={() => void run(account.id, () => platform.mail?.remove(account.id))}
                    >
                      {language.t("secondBrain.mail.settings.remove")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
            <div class="flex flex-wrap gap-2">
              <ButtonV2
                size="small"
                variant="tonal"
                disabled={state.busy !== "" || !available.latest?.gmail || !available.latest.secureStorage}
                onClick={() => void run("gmail", () => platform.mail?.connect("gmail"))}
              >
                {language.t("secondBrain.mail.settings.addGmail")}
              </ButtonV2>
              <ButtonV2
                size="small"
                variant="tonal"
                disabled={state.busy !== "" || !available.latest?.outlook || !available.latest.secureStorage}
                onClick={() => void run("outlook", () => platform.mail?.connect("outlook"))}
              >
                {language.t("secondBrain.mail.settings.addOutlook")}
              </ButtonV2>
              <ButtonV2
                size="small"
                variant="tonal"
                disabled={state.busy !== "" || !available.latest?.secureStorage}
                aria-expanded={state.imap}
                onClick={() => setState("imap", (open) => !open)}
              >
                {language.t("secondBrain.mail.settings.addImap")}
              </ButtonV2>
            </div>
            {/* Name only the providers this build has no sign-in for; the others' buttons work. */}
            <Show when={available.latest && !available.latest.gmail && !available.latest.outlook}>
              <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.mail.settings.unconfigured")}</p>
            </Show>
            <Show when={available.latest && !available.latest.gmail && available.latest.outlook}>
              <p class="type-meta text-v2-text-text-muted">
                {language.t("secondBrain.mail.settings.unconfigured.gmail")}
              </p>
            </Show>
            <Show when={available.latest && available.latest.gmail && !available.latest.outlook}>
              <p class="type-meta text-v2-text-text-muted">
                {language.t("secondBrain.mail.settings.unconfigured.outlook")}
              </p>
            </Show>
            <Show when={state.imap}>
              <form
                class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void addImap()
                }}
              >
                <label class="type-meta text-v2-text-text-muted" for="mail-imap-host">
                  {language.t("secondBrain.mail.imap.host")}
                </label>
                <input
                  id="mail-imap-host"
                  class={inputClass}
                  value={state.form.host}
                  onInput={(event) => setState("form", "host", event.currentTarget.value)}
                />
                <label class="type-meta text-v2-text-text-muted" for="mail-imap-port">
                  {language.t("secondBrain.mail.imap.port")}
                </label>
                <input
                  id="mail-imap-port"
                  type="number"
                  class={`${inputClass} w-24`}
                  value={state.form.port}
                  onInput={(event) => setState("form", "port", event.currentTarget.value)}
                />
                <label class="type-meta text-v2-text-text-muted" for="mail-imap-user">
                  {language.t("secondBrain.mail.imap.user")}
                </label>
                <input
                  id="mail-imap-user"
                  autocomplete="username"
                  class={inputClass}
                  value={state.form.user}
                  onInput={(event) => setState("form", "user", event.currentTarget.value)}
                />
                <label class="type-meta text-v2-text-text-muted" for="mail-imap-password">
                  {language.t("secondBrain.mail.imap.password")}
                </label>
                <input
                  id="mail-imap-password"
                  type="password"
                  autocomplete="current-password"
                  class={inputClass}
                  value={state.form.password}
                  onInput={(event) => setState("form", "password", event.currentTarget.value)}
                />
                <label class="type-meta text-v2-text-text-muted" for="mail-imap-address">
                  {language.t("secondBrain.mail.imap.address")}
                </label>
                <input
                  id="mail-imap-address"
                  type="email"
                  class={inputClass}
                  value={state.form.address}
                  onInput={(event) => setState("form", "address", event.currentTarget.value)}
                />
                <span />
                <label class="flex items-center gap-2 type-meta text-v2-text-text-muted">
                  <input
                    type="checkbox"
                    checked={state.form.secure}
                    onChange={(event) => setState("form", "secure", event.currentTarget.checked)}
                  />
                  {language.t("secondBrain.mail.imap.secure")}
                </label>
                <span />
                <div>
                  <ButtonV2 size="small" variant="contrast" type="submit" disabled={state.busy !== ""}>
                    {language.t("secondBrain.mail.imap.save")}
                  </ButtonV2>
                </div>
              </form>
            </Show>
            <Show when={state.failed}>
              <p role="alert" class="type-meta text-v2-text-text-critical">
                {language.t("secondBrain.mail.settings.failed")}
              </p>
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}
