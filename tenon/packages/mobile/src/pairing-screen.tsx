import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { Show, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { normalizeServer, pairDevice, readPairing, type Pairing } from "./companion"

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> }
type DetectorConstructor = new (options: { formats: string[] }) => Detector

const ERRORS = new Set(["bad_code", "expired", "locked", "invalid_name", "too_many_attempts", "unreachable", "refused"])

export function PairingScreen(props: { onPaired: (pairing: Pairing) => Promise<void> }) {
  const language = useLanguage()
  const [address, setAddress] = createSignal("")
  const [code, setCode] = createSignal("")
  const fallbackName = () => language.t(`secondBrain.companion.defaultName.${deviceKind()}`)
  const [name, setName] = createSignal(fallbackName())
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [scanning, setScanning] = createSignal(false)
  const camera = {
    stream: undefined as MediaStream | undefined,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
  }
  const scanner = () => (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  let video: HTMLVideoElement | undefined

  const fill = (text: string) => {
    const link = readPairing(text.trim())
    if (!link) return false
    setAddress(link.url)
    setCode(link.code)
    return true
  }

  const stopScan = () => {
    clearInterval(camera.timer)
    camera.stream?.getTracks().forEach((track) => track.stop())
    camera.stream = undefined
    setScanning(false)
  }
  onCleanup(stopScan)

  const scan = async () => {
    const Detector = scanner()
    if (!Detector) return
    setError("")
    const stream = await navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .catch(() => undefined)
    if (!stream) {
      setError(language.t("secondBrain.companion.error.camera"))
      return
    }
    camera.stream = stream
    setScanning(true)
    queueMicrotask(() => {
      if (!video) return
      video.srcObject = stream
      void video.play()
    })
    const detector = new Detector({ formats: ["qr_code"] })
    camera.timer = setInterval(() => {
      if (!video || video.readyState < 2) return
      void detector.detect(video).then((codes) => {
        if (codes.some((item) => fill(item.rawValue))) stopScan()
      })
    }, 400)
  }

  const submit = async () => {
    const url = normalizeServer(address())
    if (!url) {
      setError(language.t("secondBrain.companion.error.address"))
      return
    }
    setBusy(true)
    setError("")
    await pairDevice(globalThis.fetch.bind(globalThis), { url, code: code(), name: name().trim() || fallbackName() })
      .then((pairing) => props.onPaired(pairing))
      .catch((cause: unknown) => {
        const reason = cause instanceof Error && ERRORS.has(cause.message) ? cause.message : "refused"
        setError(language.t(`secondBrain.companion.error.${reason}` as "secondBrain.companion.error.refused"))
      })
    setBusy(false)
  }

  return (
    <div
      data-component="companion-pairing"
      class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-v2-background-bg-deep px-4"
      style={{ "padding-top": "calc(env(safe-area-inset-top, 0px) + 32px)" }}
    >
      <div class="flex w-full max-w-[420px] flex-col gap-6 rounded-[16px] bg-v2-background-bg-base p-6 shadow-[0_0_0_1px_var(--v2-border-border-muted)]">
        <div class="flex flex-col gap-2">
          <h1 class="type-page-title text-v2-text-text-base">{language.t("secondBrain.companion.title")}</h1>
          <p class="type-body text-v2-text-text-muted">{language.t("secondBrain.companion.intro")}</p>
        </div>
        <Show when={scanner()}>
          <div class="flex flex-col gap-2">
            <Show
              when={scanning()}
              fallback={
                <ButtonV2 variant="tonal" data-action="companion-scan" onClick={() => void scan()}>
                  {language.t("secondBrain.companion.scan")}
                </ButtonV2>
              }
            >
              <video
                ref={(element) => (video = element)}
                class="aspect-square w-full rounded-[12px] bg-v2-background-bg-layer-01 object-cover"
                muted
                playsinline
              />
              <ButtonV2 variant="neutral" onClick={stopScan}>
                {language.t("common.cancel")}
              </ButtonV2>
            </Show>
          </div>
        </Show>
        <label class="flex flex-col gap-1.5">
          <span class="type-section text-v2-text-text-base">{language.t("secondBrain.companion.address")}</span>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full"
            inputmode="url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            placeholder="192.168.1.20:47100"
            value={address()}
            data-field="companion-address"
            onInput={(event) => {
              if (!fill(event.currentTarget.value)) setAddress(event.currentTarget.value)
            }}
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="type-section text-v2-text-text-base">{language.t("secondBrain.companion.code")}</span>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full font-mono"
            autocomplete="one-time-code"
            autocapitalize="characters"
            spellcheck={false}
            placeholder="ABCD-2345"
            value={code()}
            data-field="companion-code"
            onInput={(event) => setCode(event.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="type-section text-v2-text-text-base">{language.t("secondBrain.companion.name")}</span>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full"
            value={name()}
            data-field="companion-name"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <Show when={error()}>
          <p role="alert" class="type-meta text-v2-text-text-critical" data-slot="companion-error">
            {error()}
          </p>
        </Show>
        <ButtonV2
          size="large"
          variant="contrast"
          data-action="companion-pair"
          disabled={busy() || !address().trim() || !code().trim()}
          onClick={() => void submit()}
        >
          {language.t("secondBrain.companion.pair")}
        </ButtonV2>
        <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.companion.network")}</p>
      </div>
    </div>
  )
}

function deviceKind() {
  const agent = typeof navigator === "object" ? navigator.userAgent : ""
  if (/iPhone|iPad/.test(agent)) return "iphone" as const
  if (/Android/.test(agent)) return "android" as const
  return "other" as const
}
