import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { SelectV2 } from "@tenon/ui/v2/select-v2"
import { Switch } from "@tenon/ui/v2/switch-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type RemoteAccessPlatform, type RemoteAccessStatus } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { deviceRows, pairingLink, qrPath, type PairedDevice } from "./remote-access-model"
import { ownerRequest } from "./thread-sync-client"
import { syncErrorCode } from "./thread-sync-model"

const KNOWN_ERRORS = new Set([
  "remote_address_invalid",
  "remote_port_invalid",
  "remote_address_gone",
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "EACCES",
])

export function PhoneAccessSettings(props: { remote: RemoteAccessPlatform }) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const client = () => ({ server: serverSDK().server, fetch: platform.fetch })
  const [status, { mutate: setStatus }] = createResource(() => props.remote.status())
  const [devices, { refetch: refetchDevices }] = createResource(() =>
    ownerRequest<{ devices: PairedDevice[] }>(client(), "GET", "/api/remote/devices")
      .then((answer) => answer.devices)
      .catch(() => [] as PairedDevice[]),
  )
  const [choice, setChoice] = createSignal<{ address?: string; port?: string }>({})
  const [pairing, setPairing] = createSignal<{ code: string; expiresAt: number; url: string }>()
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(tick))

  const errorText = (code: string) =>
    KNOWN_ERRORS.has(code)
      ? language.t(
          `secondBrain.settings.remote.error.${code}` as "secondBrain.settings.remote.error.remote_address_gone",
        )
      : language.t("secondBrain.settings.remote.error.unknown", { code })

  const address = () => choice().address || status.latest?.address || status.latest?.addresses[0]?.address || ""
  const port = () => choice().port ?? String(status.latest?.port ?? 47100)
  const options = createMemo(() =>
    (status.latest?.addresses ?? []).map((item) => ({ value: item.address, label: `${item.address} (${item.name})` })),
  )
  const live = () => {
    const current = pairing()
    return current && current.expiresAt > now() ? current : undefined
  }
  const qr = createMemo(() => {
    const current = pairing()
    return current ? qrPath(pairingLink({ url: current.url, code: current.code })) : undefined
  })

  const apply = async (enabled: boolean) => {
    setBusy(true)
    setError("")
    const next: RemoteAccessStatus | undefined = await props.remote
      .configure({ enabled, address: address(), port: Number(port()) })
      .catch((cause: unknown) => {
        setError(errorText(syncErrorCode(cause)))
        return undefined
      })
    if (next) setStatus(next)
    if (next && !next.running) setPairing(undefined)
    setChoice({})
    setBusy(false)
  }

  const pair = async () => {
    const url = status.latest?.url
    if (!url) return
    setError("")
    const answer = await ownerRequest<{ code: string; expiresAt: number }>(
      client(),
      "POST",
      "/api/remote/pairing-code",
    ).catch(() => undefined)
    if (!answer) {
      setError(language.t("secondBrain.settings.remote.error.pairing"))
      return
    }
    setPairing({ ...answer, url })
    void refetchDevices()
  }

  const revoke = async (id: string) => {
    await ownerRequest(client(), "DELETE", `/api/remote/devices/${encodeURIComponent(id)}`).catch(() =>
      setError(language.t("secondBrain.settings.remote.error.revoke")),
    )
    void refetchDevices()
  }

  const seen = (row: ReturnType<typeof deviceRows>[number]) => {
    const label = row.seen
    if (label.key === "secondBrain.settings.remote.seen.minutes")
      return language.t(label.key, { minutes: label.minutes })
    if (label.key === "secondBrain.settings.remote.seen.hours") return language.t(label.key, { hours: label.hours })
    if (label.key === "secondBrain.settings.remote.seen.days") return language.t(label.key, { days: label.days })
    return language.t(label.key)
  }

  return (
    <div class="flex flex-col gap-8 pt-8" data-component="phone-access-settings">
      <div class="settings-v2-section">
        <h4 class="settings-v2-section-title">{language.t("secondBrain.settings.remote.title")}</h4>
        <div class="settings-v2-provider-empty" role="note" data-slot="phone-access-warning">
          {language.t("secondBrain.settings.remote.warning")}
        </div>
        <Show when={error() || status.latest?.error}>
          <div class="settings-v2-provider-empty" role="alert" data-slot="phone-access-error">
            {error() || errorText(status.latest?.error ?? "")}
          </div>
        </Show>
        <SettingsListV2>
          <SettingsRowV2
            title={language.t("secondBrain.settings.remote.enabled")}
            description={
              status.latest?.url
                ? language.t("secondBrain.settings.remote.running", { url: status.latest.url })
                : language.t("secondBrain.settings.remote.enabled.description")
            }
          >
            <Switch
              checked={status.latest?.enabled ?? false}
              disabled={busy() || !status.latest || options().length === 0}
              hideLabel
              onChange={(value: boolean) => void apply(value)}
            >
              {language.t("secondBrain.settings.remote.enabled")}
            </Switch>
          </SettingsRowV2>
          <SettingsRowV2
            title={language.t("secondBrain.settings.remote.address")}
            description={
              options().length === 0
                ? language.t("secondBrain.settings.remote.address.none")
                : language.t("secondBrain.settings.remote.address.description")
            }
          >
            <SelectV2
              appearance="inline"
              data-action="phone-access-address"
              options={options()}
              current={options().find((option) => option.value === address())}
              placement="bottom-end"
              gutter={6}
              disabled={busy() || options().length === 0}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && setChoice({ ...choice(), address: option.value })}
            />
          </SettingsRowV2>
          <SettingsRowV2 title={language.t("secondBrain.settings.remote.port")}>
            <div class="flex items-center gap-2">
              <TextInputV2
                type="text"
                inputmode="numeric"
                appearance="base"
                class="!w-[96px]"
                value={port()}
                aria-label={language.t("secondBrain.settings.remote.port")}
                onInput={(event) => setChoice({ ...choice(), port: event.currentTarget.value })}
              />
              <ButtonV2
                size="small"
                variant="tonal"
                data-action="phone-access-apply"
                disabled={busy() || (choice().address === undefined && choice().port === undefined)}
                onClick={() => void apply(status.latest?.enabled ?? false)}
              >
                {language.t("common.save")}
              </ButtonV2>
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>

      <div class="settings-v2-section">
        <SettingsListV2>
          <SettingsRowV2
            title={language.t("secondBrain.settings.remote.pair")}
            description={language.t("secondBrain.settings.remote.pair.description")}
          >
            <ButtonV2
              size="small"
              variant="tonal"
              data-action="phone-access-pair"
              disabled={!status.latest?.running}
              onClick={() => void pair()}
            >
              {language.t("secondBrain.settings.remote.pair.button")}
            </ButtonV2>
          </SettingsRowV2>
          <Show when={live()}>
            {(current) => (
              <div data-component="settings-v2-row" data-slot="phone-access-pairing">
                <div data-slot="settings-v2-row-copy">
                  <div data-slot="settings-v2-row-title">{language.t("secondBrain.settings.remote.pair.scan")}</div>
                  <div data-slot="settings-v2-row-description">
                    <div class="font-mono type-body [letter-spacing:0.08em]" data-slot="phone-access-code">
                      {`${current().code.slice(0, 4)}-${current().code.slice(4)}`}
                    </div>
                    <div>{current().url}</div>
                    <div>
                      {language.t("secondBrain.settings.remote.pair.expires", {
                        seconds: Math.max(0, Math.ceil((current().expiresAt - now()) / 1000)),
                      })}
                    </div>
                  </div>
                </div>
                <div data-slot="settings-v2-row-control">
                  <Show when={qr()}>
                    {(code) => (
                      <svg
                        role="img"
                        aria-label={language.t("secondBrain.settings.remote.pair.qr")}
                        data-slot="phone-access-qr"
                        class="size-[168px] rounded-[var(--v2-radius-sm)]"
                        viewBox={`-4 -4 ${code().size + 8} ${code().size + 8}`}
                        shape-rendering="crispEdges"
                      >
                        <rect x="-4" y="-4" width={code().size + 8} height={code().size + 8} fill="var(--v2-grey-50)" />
                        <path d={code().path} fill="var(--v2-grey-1000)" />
                      </svg>
                    )}
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </SettingsListV2>
      </div>

      <div class="settings-v2-section">
        <h4 class="settings-v2-section-title">{language.t("secondBrain.settings.remote.devices")}</h4>
        <SettingsListV2>
          <For
            each={deviceRows(devices.latest ?? [], now())}
            fallback={
              <SettingsRowV2 title={language.t("secondBrain.settings.remote.devices.empty")}>
                <span />
              </SettingsRowV2>
            }
          >
            {(row) => (
              <SettingsRowV2
                title={row.name}
                description={language.t("secondBrain.settings.remote.devices.row", {
                  paired: new Date(row.createdAt).toLocaleDateString(),
                  seen: seen(row),
                })}
              >
                <ButtonV2
                  size="small"
                  variant="neutral"
                  data-action="phone-access-revoke"
                  onClick={() => void revoke(row.id)}
                >
                  {language.t("secondBrain.settings.remote.revoke")}
                </ButtonV2>
              </SettingsRowV2>
            )}
          </For>
        </SettingsListV2>
      </div>
    </div>
  )
}
