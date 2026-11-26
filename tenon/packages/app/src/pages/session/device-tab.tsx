import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { For, Show, createEffect, createMemo, createResource, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type DeviceInfo } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import type { ImageAttachmentPart } from "@/context/prompt-state"
import { createBlobReference } from "@/utils/draft-store"
import { uuid } from "@/utils/uuid"
import { createVisibleInterval } from "@/utils/visible-interval"
import {
  BOOT_POLL_MS,
  FRAME_INSET,
  PLACEHOLDER_FRAME,
  bootStage,
  deviceError,
  deviceHint,
  fitFrame,
  type BootStage,
} from "./device-boot"

const FRAME_MS = 700
const BOOT_MESSAGES = {
  idle: "secondBrain.device.boot.starting",
  starting: "secondBrain.device.boot.starting",
  slow: "secondBrain.device.boot.slow",
  timeout: "secondBrain.device.boot.timeout",
} as const satisfies Record<BootStage, string>

type DeviceTabState = {
  os: DeviceInfo["platform"]
  selected: string
  frame: string
  error: string
  activity: string[]
  boot: { os: DeviceInfo["platform"]; name: string; requestedAt: number | undefined }
  now: number
  shown: string
  natural: { width: number; height: number }
  box: { width: number; height: number }
}

export function SessionDeviceTab() {
  const language = useLanguage()
  const platform = usePlatform()
  const prompt = usePrompt()
  const device = platform.device
  const [status, { refetch }] = createResource(() => device?.status())
  const [state, setState] = createStore<DeviceTabState>({
    os: "android",
    selected: "",
    frame: "",
    error: "",
    activity: [],
    boot: { os: "android", name: "", requestedAt: undefined },
    now: Date.now(),
    shown: "",
    natural: { width: 0, height: 0 },
    box: { width: 0, height: 0 },
  })
  const devices = createMemo(() =>
    state.os === "android" ? (status.latest?.android.devices ?? []) : (status.latest?.ios.devices ?? []),
  )
  const running = createMemo(() =>
    devices().filter((item) => (item.platform === "android" ? item.state === "device" : item.state === "Booted")),
  )
  const current = createMemo(() => running().find((item) => item.id === state.selected) ?? running()[0])
  const attached = createMemo(() =>
    devices().flatMap((item) => {
      const hint = deviceHint(item)
      return hint ? [{ ...item, hint }] : []
    }),
  )
  const stage = createMemo(() => {
    const boot = state.boot
    const list = boot.os === "android" ? (status.latest?.android.devices ?? []) : (status.latest?.ios.devices ?? [])
    return bootStage({
      requestedAt: boot.requestedAt,
      now: state.now,
      running: list.some((item) => (item.platform === "android" ? item.state === "device" : item.state === "Booted")),
    })
  })
  const booting = () => stage() === "starting" || stage() === "slow"
  const boot = (id: string, name: string) => {
    if (!device) return
    const os = state.os
    const now = Date.now()
    setState({ boot: { os, name, requestedAt: now }, now, error: "" })
    void device.boot(os, id).then(
      () => refetch(),
      (cause: unknown) =>
        setState({
          boot: { os, name, requestedAt: undefined },
          error: deviceError(cause),
        }),
    )
  }
  createEffect(() => {
    if (state.boot.requestedAt !== undefined && stage() === "idle") setState("boot", "requestedAt", undefined)
  })
  createEffect(() => {
    const id = current()?.id
    if (state.shown && state.shown !== id) setState({ frame: "", error: "", shown: "" })
  })
  const screen = createMemo(() => {
    const natural = state.natural.width > 0 ? state.natural : PLACEHOLDER_FRAME
    return fitFrame({
      boxWidth: state.box.width,
      boxHeight: state.box.height,
      imageWidth: natural.width,
      imageHeight: natural.height,
      inset: FRAME_INSET,
    })
  })
  const unavailable = createMemo(() => {
    const value = status.latest
    if (!device) return language.t("secondBrain.device.desktopOnly")
    if (!value) return
    if (state.os === "ios" && !value.ios.supported) return language.t("secondBrain.device.ios.macOnly")
    if (state.os === "android" && !value.android.sdk) return language.t("secondBrain.device.android.noSdk")
  })

  onMount(() => {
    if (!device) return
    let busy = false
    const timer = setInterval(() => {
      const target = current()
      if (!target || busy || document.hidden) return
      busy = true
      void device
        .screenshot(target.platform, target.id)
        .then(
          (frame) => {
            if (frame && current()?.id === target.id) setState({ frame, error: "", shown: target.id })
          },
          (cause: unknown) => {
            if (current()?.id === target.id) setState({ error: deviceError(cause), shown: target.id })
          },
        )
        .finally(() => (busy = false))
    }, FRAME_MS)
    const off = device.onAgent((event) =>
      setState(
        "activity",
        produce((list) => void list.push(`${new Date().toLocaleTimeString()}  ${event.tool}`)),
      ),
    )
    createVisibleInterval(() => void refetch(), 5_000)
    createVisibleInterval(() => {
      if (state.boot.requestedAt === undefined) return
      setState("now", Date.now())
      if (booting()) void refetch()
    }, BOOT_POLL_MS)
    onCleanup(() => {
      clearInterval(timer)
      off()
    })
  })

  let image: HTMLImageElement | undefined
  const measure = (element: HTMLDivElement) => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setState("box", { width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }
  const tap = (event: MouseEvent) => {
    const target = current()
    if (!device || !target || !image) return
    const rect = image.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * image.naturalWidth
    const y = ((event.clientY - rect.top) / rect.height) * image.naturalHeight
    void device
      .input(target.platform, target.id, { kind: "tap", x, y })
      .catch((cause: unknown) => setState("error", deviceError(cause)))
  }
  const key = (name: "home" | "back") => {
    const target = current()
    if (!device || !target) return
    void device
      .input(target.platform, target.id, { kind: "key", key: name })
      .catch((cause: unknown) => setState("error", deviceError(cause)))
  }
  const attach = async () => {
    if (!state.frame) return
    const blob = await (await fetch(state.frame)).blob()
    const part: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: `${current()?.name ?? "device"}.png`,
      mime: "image/png",
      blob: await createBlobReference(blob),
    }
    prompt.set([...prompt.current(), part])
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 px-3 pb-3" data-component="device-tab">
      <div class="flex flex-wrap items-center gap-1">
        <div
          class="flex gap-1 rounded-full bg-v2-background-bg-layer-01 p-0.5"
          role="group"
          aria-label={language.t("secondBrain.device.platform")}
        >
          <For each={["android", "ios"] as const}>
            {(os) => (
              <button
                type="button"
                class="h-7 rounded-full px-3 text-12-medium text-v2-text-text-muted transition-[background-color,color] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none aria-pressed:bg-v2-background-bg-accent-container aria-pressed:text-v2-text-text-on-accent-container"
                aria-pressed={state.os === os}
                data-action={`device-os-${os}`}
                onClick={() => setState({ os, selected: "", frame: "", error: "" })}
              >
                {language.t(os === "android" ? "secondBrain.device.android" : "secondBrain.device.ios")}
              </button>
            )}
          </For>
        </div>
        <Show when={running().length > 1}>
          <select
            class="h-8 rounded-full bg-v2-background-bg-layer-01 px-3 text-12-regular"
            aria-label={language.t("secondBrain.device.select")}
            value={current()?.id}
            onChange={(event) => setState({ selected: event.currentTarget.value, frame: "" })}
          >
            <For each={running()}>{(item) => <option value={item.id}>{item.name}</option>}</For>
          </select>
        </Show>
        <span class="flex-1" />
        <span class="rounded-full bg-v2-background-bg-layer-02 px-2 py-0.5 text-11-medium text-v2-text-text-muted">
          {current() ? current()!.name : language.t("secondBrain.device.none")}
        </span>
      </div>

      <Show
        when={!unavailable()}
        fallback={
          <div
            class="m-auto max-w-80 px-6 text-center text-[13px] leading-6 text-v2-text-text-muted"
            data-slot="device-unavailable"
          >
            {unavailable()}
            <Show when={state.os === "ios" && !status.latest?.ios.supported && status.latest?.android.sdk}>
              <div class="pt-3">
                <ButtonV2 size="small" variant="tonal" onClick={() => setState("os", "android")}>
                  {language.t("secondBrain.device.useAndroid")}
                </ButtonV2>
              </div>
            </Show>
          </div>
        }
      >
        <Show
          when={current()}
          fallback={
            <div class="m-auto flex max-w-80 flex-col items-center gap-3 px-6 text-center text-[13px] text-v2-text-text-muted">
              <span>{language.t("secondBrain.device.start")}</span>
              <For
                each={state.os === "android" ? (status.latest?.android.avds ?? []) : devices().map((item) => item.id)}
              >
                {(id) => {
                  const name = () =>
                    state.os === "android" ? id : (devices().find((item) => item.id === id)?.name ?? id)
                  return (
                    <ButtonV2 size="small" variant="tonal" disabled={booting()} onClick={() => boot(id, name())}>
                      {name()}
                    </ButtonV2>
                  )
                }}
              </For>
              <Show when={state.boot.os === state.os && stage() !== "idle"}>
                <span class="text-12-regular" role="status" aria-live="polite" data-slot="device-boot">
                  {language.t(BOOT_MESSAGES[stage()], { name: state.boot.name })}
                </span>
              </Show>
              <Show when={attached().length > 0}>
                <ul class="flex w-full flex-col gap-1" data-slot="device-attached">
                  <For each={attached()}>
                    {(item) => (
                      <li class="flex flex-col rounded-xl bg-v2-background-bg-layer-01 px-3 py-2 text-left">
                        <span class="text-12-medium text-v2-text-text-base">{item.name}</span>
                        <span class="text-12-regular text-v2-state-fg-warning">
                          {language.t(`secondBrain.device.hint.${item.hint}`)}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          }
        >
          <div class="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-2" data-slot="device-stage">
            <div class="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center" ref={measure}>
              <Show when={screen().width > 0}>
                <div
                  class="rounded-[var(--v2-radius-xl)] bg-[#171717] shadow-[var(--v2-elevation-raised)]"
                  style={{ padding: `${FRAME_INSET}px` }}
                  data-slot="device-bezel"
                >
                  <Show
                    when={state.frame}
                    fallback={
                      <div
                        class="animate-pulse rounded-[var(--v2-radius-lg)] bg-[#262626] motion-reduce:animate-none"
                        style={{ width: `${screen().width}px`, height: `${screen().height}px` }}
                        data-slot="device-placeholder"
                      />
                    }
                  >
                    <img
                      ref={image}
                      src={state.frame}
                      alt={language.t("secondBrain.device.screen", { name: current()!.name })}
                      class="block rounded-[var(--v2-radius-lg)]"
                      style={{ width: `${screen().width}px`, height: `${screen().height}px` }}
                      onLoad={(event) =>
                        setState("natural", {
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }
                      onClick={tap}
                    />
                  </Show>
                </div>
              </Show>
            </div>
            <div
              class="flex shrink-0 items-center gap-0.5 rounded-full bg-v2-background-bg-layer-01 p-0.5"
              role="toolbar"
              aria-label={language.t("secondBrain.device.controls")}
            >
              <TooltipV2 placement="top" value={language.t("secondBrain.device.home")}>
                <IconButtonV2
                  icon={<Icon name="home" />}
                  variant="ghost"
                  size="small"
                  aria-label={language.t("secondBrain.device.home")}
                  data-action="device-home"
                  onClick={() => key("home")}
                />
              </TooltipV2>
              <Show when={state.os === "android"}>
                <TooltipV2 placement="top" value={language.t("secondBrain.device.back")}>
                  <IconButtonV2
                    icon={<Icon name="arrow-left" />}
                    variant="ghost"
                    size="small"
                    aria-label={language.t("secondBrain.device.back")}
                    data-action="device-back"
                    onClick={() => key("back")}
                  />
                </TooltipV2>
              </Show>
              <TooltipV2 placement="top" value={language.t("secondBrain.device.attach")}>
                <IconButtonV2
                  icon={<Icon name="photo" />}
                  variant="ghost"
                  size="small"
                  aria-label={language.t("secondBrain.device.attach")}
                  data-action="device-attach"
                  disabled={!state.frame}
                  onClick={() => void attach()}
                />
              </TooltipV2>
            </div>
          </div>
        </Show>
      </Show>

      <Show when={state.error}>
        <div class="rounded-xl bg-v2-state-bg-danger px-3 py-2 text-12-regular text-v2-state-fg-danger" role="alert">
          {state.error}
        </div>
      </Show>
      <Show when={state.activity.length > 0}>
        <div class="max-h-20 overflow-auto rounded-xl bg-v2-background-bg-layer-01 px-3 py-2 font-mono text-11-regular text-v2-text-text-muted">
          <For each={state.activity.slice(-8)}>{(line) => <div>{line}</div>}</For>
        </div>
      </Show>
    </div>
  )
}
