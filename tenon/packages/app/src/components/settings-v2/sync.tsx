import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Switch } from "@tenon/ui/v2/switch-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { For, Show, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type ThreadSyncDesktopStatus } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { threadSyncApi, ThreadSyncRequestError, type ThreadSyncServerStatus } from "./thread-sync-client"
import { nextSyncStep, storedThreadView, syncErrorCode } from "./thread-sync-model"
import "./settings-v2.css"

const KNOWN_ERRORS = new Set([
  "secure_storage_unavailable",
  "google_client_id_invalid",
  "google_client_secret_invalid",
  "google_client_missing",
  "google_oauth_denied",
  "google_oauth_timeout",
  "google_oauth_cancelled",
  "google_refresh_token_missing",
  "google_scope_missing",
  "google_reconnect_required",
  "google_unavailable",
  "google_operation_busy",
  "key_exists",
  "invalid_phrase",
  "invalid_name",
  "not_ready",
  "not_owner",
  "diverged",
  "unavailable",
  "unauthorized",
  "unreadable",
  "foreign_path",
  "not_found",
])

export function SettingsSyncV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const client = () => ({ server: serverSDK().server, fetch: platform.fetch })
  const [desktop, { mutate: setDesktop }] = createResource(() => platform.threadSync?.status())
  const [server, { mutate: setServer, refetch: refetchServer }] = createResource(() =>
    threadSyncApi.status(client()).catch(() => undefined),
  )
  const [threads, { refetch: refetchThreads }] = createResource(
    () => (server.latest?.ready ? true : undefined),
    () => threadSyncApi.threads(client()).catch((cause: unknown) => fail(cause, [])),
  )
  const [error, setError] = createSignal("")
  const [phrase, setPhrase] = createSignal("")
  const [form, setForm] = createSignal({ clientId: "", clientSecret: "", recovery: "", folder: "", machine: "" })
  const [busy, setBusy] = createSignal(false)

  const errorText = (code: string) =>
    KNOWN_ERRORS.has(code)
      ? language.t(`secondBrain.settings.sync.error.${code}` as "secondBrain.settings.sync.error.unknown")
      : language.t("secondBrain.settings.sync.error.unknown", { code })

  function fail<T>(cause: unknown, value: T) {
    setError(errorText(cause instanceof ThreadSyncRequestError ? cause.code : syncErrorCode(cause)))
    return value
  }

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    await work()
      .catch((cause: unknown) => fail(cause, undefined))
      .finally(() => setBusy(false))
    const latest = await platform.threadSync?.status()
    if (latest) setDesktop(latest)
    void refetchServer()
  }
  const desktopAction = (work: () => Promise<ThreadSyncDesktopStatus | undefined>) =>
    run(async () => {
      const next = await work()
      if (next) setDesktop(next)
    })
  const configure = (change: { enabled?: boolean; driveFolder?: string; machineName?: string }) =>
    run(async () => {
      const next: ThreadSyncServerStatus = await threadSyncApi.configure(client(), change)
      setServer(next)
    })
  const continueHere = (sessionID: string) =>
    run(async () => {
      if (platform.platform !== "desktop") return
      const picked = await platform.openDirectoryPickerDialog({
        title: language.t("secondBrain.settings.sync.continue.pick"),
      })
      const directory = Array.isArray(picked) ? picked[0] : picked
      if (!directory) return
      await threadSyncApi.continueHere(client(), sessionID, directory)
      void refetchThreads()
    })

  const step = () => {
    const local = desktop.latest
    const remote = server.latest
    if (!local || !remote) return undefined
    return nextSyncStep(local, remote)
  }
  const update = (field: keyof ReturnType<typeof form>, value: string) => setForm({ ...form(), [field]: value })

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.settings.sync.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="thread-sync-settings">
        <Show
          when={platform.threadSync}
          fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.settings.sync.desktopOnly")}</div>}
        >
          {(sync) => (
            <>
              <Show when={step()}>
                {(current) => (
                  <div class="settings-v2-provider-empty" data-slot="thread-sync-next">
                    {language.t(`secondBrain.settings.sync.step.${current()}`)}
                  </div>
                )}
              </Show>
              <Show when={error()}>
                <div class="settings-v2-provider-empty" role="alert" data-slot="thread-sync-error">
                  {error()}
                </div>
              </Show>

              <div class="settings-v2-section">
                <h4 class="settings-v2-section-title">{language.t("secondBrain.settings.sync.google")}</h4>
                <SettingsListV2>
                  <SettingsRowV2
                    title={language.t("secondBrain.settings.sync.client")}
                    description={
                      desktop.latest?.clientId
                        ? language.t("secondBrain.settings.sync.client.saved", { id: desktop.latest.clientId })
                        : language.t("secondBrain.settings.sync.client.description")
                    }
                  >
                    <div class="flex flex-col items-end gap-2">
                      <TextInputV2
                        type="text"
                        appearance="base"
                        class="!w-[180px] max-w-full"
                        value={form().clientId}
                        placeholder={language.t("secondBrain.settings.sync.client.id")}
                        aria-label={language.t("secondBrain.settings.sync.client.id")}
                        spellcheck={false}
                        autocomplete="off"
                        onInput={(event) => update("clientId", event.currentTarget.value)}
                      />
                      <TextInputV2
                        type="password"
                        appearance="base"
                        class="!w-[180px] max-w-full"
                        value={form().clientSecret}
                        placeholder={language.t("secondBrain.settings.sync.client.secret")}
                        aria-label={language.t("secondBrain.settings.sync.client.secret")}
                        autocomplete="off"
                        onInput={(event) => update("clientSecret", event.currentTarget.value)}
                      />
                      <ButtonV2
                        size="small"
                        variant="tonal"
                        data-action="thread-sync-save-client"
                        disabled={busy() || !form().clientId.trim() || !form().clientSecret.trim()}
                        onClick={() =>
                          void desktopAction(async () => {
                            const next = await sync().setClient({
                              clientId: form().clientId,
                              clientSecret: form().clientSecret,
                            })
                            setForm({ ...form(), clientId: "", clientSecret: "" })
                            return next
                          })
                        }
                      >
                        {language.t("common.save")}
                      </ButtonV2>
                    </div>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={
                      desktop.latest?.signedIn
                        ? language.t("secondBrain.settings.sync.signedIn")
                        : language.t("secondBrain.settings.sync.signedOut")
                    }
                    description={language.t("secondBrain.settings.sync.scope")}
                  >
                    <Show
                      when={!desktop.latest?.signedIn}
                      fallback={
                        <ButtonV2
                          size="small"
                          variant="tonal"
                          data-action="thread-sync-sign-out"
                          disabled={busy()}
                          onClick={() => void desktopAction(() => sync().signOut())}
                        >
                          {language.t("secondBrain.settings.sync.signOut")}
                        </ButtonV2>
                      }
                    >
                      <Show
                        when={!busy()}
                        fallback={
                          <ButtonV2
                            size="small"
                            variant="tonal"
                            data-action="thread-sync-cancel-sign-in"
                            onClick={() => void sync().cancelSignIn()}
                          >
                            {language.t("common.cancel")}
                          </ButtonV2>
                        }
                      >
                        <ButtonV2
                          size="small"
                          variant="tonal"
                          data-action="thread-sync-sign-in"
                          disabled={!desktop.latest?.clientId}
                          onClick={() => void desktopAction(() => sync().signIn())}
                        >
                          {language.t("secondBrain.settings.sync.signIn")}
                        </ButtonV2>
                      </Show>
                    </Show>
                  </SettingsRowV2>
                </SettingsListV2>
              </div>

              <div class="settings-v2-section">
                <h4 class="settings-v2-section-title">{language.t("secondBrain.settings.sync.key")}</h4>
                <SettingsListV2>
                  <Show when={phrase()}>
                    <SettingsRowV2
                      title={language.t("secondBrain.settings.sync.phrase")}
                      description={
                        <span class="font-mono [overflow-wrap:anywhere]" data-slot="thread-sync-phrase">
                          {phrase()}
                        </span>
                      }
                    >
                      <div class="flex items-center gap-2">
                        <ButtonV2
                          size="small"
                          variant="tonal"
                          onClick={() => void navigator.clipboard?.writeText(phrase()).catch(() => undefined)}
                        >
                          {language.t("secondBrain.settings.sync.phrase.copy")}
                        </ButtonV2>
                        <ButtonV2 size="small" data-action="thread-sync-phrase-saved" onClick={() => setPhrase("")}>
                          {language.t("secondBrain.settings.sync.phrase.saved")}
                        </ButtonV2>
                      </div>
                    </SettingsRowV2>
                  </Show>
                  <SettingsRowV2
                    title={
                      desktop.latest?.key
                        ? language.t("secondBrain.settings.sync.key.present")
                        : language.t("secondBrain.settings.sync.key.absent")
                    }
                    description={language.t("secondBrain.settings.sync.key.description")}
                  >
                    <Show
                      when={!desktop.latest?.key}
                      fallback={
                        <ButtonV2
                          size="small"
                          variant="tonal"
                          disabled={busy()}
                          onClick={() => void desktopAction(() => sync().forgetKey())}
                        >
                          {language.t("secondBrain.settings.sync.key.forget")}
                        </ButtonV2>
                      }
                    >
                      <ButtonV2
                        size="small"
                        variant="tonal"
                        data-action="thread-sync-create-key"
                        disabled={busy()}
                        onClick={() =>
                          void desktopAction(async () => {
                            const made = await sync().createKey()
                            setPhrase(made.phrase)
                            return made.status
                          })
                        }
                      >
                        {language.t("secondBrain.settings.sync.key.create")}
                      </ButtonV2>
                    </Show>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("secondBrain.settings.sync.recovery")}
                    description={language.t("secondBrain.settings.sync.recovery.description")}
                  >
                    <div class="flex items-center gap-2">
                      <TextInputV2
                        type="password"
                        appearance="base"
                        class="!w-[180px] max-w-full"
                        value={form().recovery}
                        placeholder={language.t("secondBrain.settings.sync.recovery.placeholder")}
                        aria-label={language.t("secondBrain.settings.sync.recovery")}
                        autocomplete="off"
                        spellcheck={false}
                        onInput={(event) => update("recovery", event.currentTarget.value)}
                      />
                      <ButtonV2
                        size="small"
                        variant="tonal"
                        data-action="thread-sync-enter-phrase"
                        disabled={busy() || !form().recovery.trim()}
                        onClick={() =>
                          void desktopAction(async () => {
                            const next = await sync().enterPhrase(form().recovery)
                            setForm({ ...form(), recovery: "" })
                            return next
                          })
                        }
                      >
                        {language.t("secondBrain.settings.sync.recovery.use")}
                      </ButtonV2>
                    </div>
                  </SettingsRowV2>
                </SettingsListV2>
              </div>

              <div class="settings-v2-section">
                <h4 class="settings-v2-section-title">{language.t("secondBrain.settings.sync.threads")}</h4>
                <SettingsListV2>
                  <SettingsRowV2
                    title={language.t("secondBrain.settings.sync.enabled")}
                    description={
                      server.latest?.lastError
                        ? language.t("secondBrain.settings.sync.lastError", { error: server.latest.lastError })
                        : language.t("secondBrain.settings.sync.enabled.description")
                    }
                  >
                    <Switch
                      checked={server.latest?.enabled ?? false}
                      disabled={busy() || !server.latest}
                      hideLabel
                      onChange={(value: boolean) => void configure({ enabled: value })}
                    >
                      {language.t("secondBrain.settings.sync.enabled")}
                    </Switch>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("secondBrain.settings.sync.folder")}
                    description={server.latest?.driveFolder}
                  >
                    <div class="flex items-center gap-2">
                      <TextInputV2
                        type="text"
                        appearance="base"
                        class="!w-[180px] max-w-full"
                        value={form().folder}
                        placeholder={server.latest?.driveFolder ?? ""}
                        aria-label={language.t("secondBrain.settings.sync.folder")}
                        onInput={(event) => update("folder", event.currentTarget.value)}
                      />
                      <ButtonV2
                        size="small"
                        variant="tonal"
                        disabled={busy() || !form().folder.trim()}
                        onClick={() => void configure({ driveFolder: form().folder }).then(() => update("folder", ""))}
                      >
                        {language.t("common.save")}
                      </ButtonV2>
                    </div>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("secondBrain.settings.sync.machine")}
                    description={server.latest?.machine.name}
                  >
                    <div class="flex items-center gap-2">
                      <TextInputV2
                        type="text"
                        appearance="base"
                        class="!w-[180px] max-w-full"
                        value={form().machine}
                        placeholder={server.latest?.machine.name ?? ""}
                        aria-label={language.t("secondBrain.settings.sync.machine")}
                        onInput={(event) => update("machine", event.currentTarget.value)}
                      />
                      <ButtonV2
                        size="small"
                        variant="tonal"
                        disabled={busy() || !form().machine.trim()}
                        onClick={() =>
                          void configure({ machineName: form().machine }).then(() => update("machine", ""))
                        }
                      >
                        {language.t("common.save")}
                      </ButtonV2>
                    </div>
                  </SettingsRowV2>
                </SettingsListV2>
              </div>

              <Show when={server.latest?.ready}>
                <div class="settings-v2-section" data-slot="thread-sync-stored">
                  <div class="flex items-center gap-2">
                    <h4 class="settings-v2-section-title flex-1">{language.t("secondBrain.settings.sync.stored")}</h4>
                    <ButtonV2
                      size="small"
                      variant="tonal"
                      disabled={threads.loading}
                      onClick={() => void refetchThreads()}
                    >
                      {language.t("secondBrain.settings.sync.refresh")}
                    </ButtonV2>
                  </div>
                  <SettingsListV2>
                    <For
                      each={threads.latest ?? []}
                      fallback={
                        <SettingsRowV2 title={language.t("secondBrain.settings.sync.stored.empty")}>
                          <span />
                        </SettingsRowV2>
                      }
                    >
                      {(thread) => {
                        const view = () => storedThreadView(thread)
                        return (
                          <SettingsRowV2
                            title={thread.title}
                            description={language.t("secondBrain.settings.sync.stored.row", {
                              owner: view().mine ? language.t("secondBrain.settings.sync.thisComputer") : view().owner,
                              state: language.t(view().state),
                            })}
                          >
                            <Show when={view().canContinue} fallback={<span />}>
                              <ButtonV2
                                size="small"
                                variant="tonal"
                                data-action="thread-sync-continue"
                                disabled={busy()}
                                onClick={() => void continueHere(thread.sessionID)}
                              >
                                {language.t("secondBrain.settings.sync.continue")}
                              </ButtonV2>
                            </Show>
                          </SettingsRowV2>
                        )
                      }}
                    </For>
                  </SettingsListV2>
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </>
  )
}
