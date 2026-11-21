import { Switch as ToggleSwitch } from "@tenon/ui/v2/switch-v2"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { getComputerUse, listHarnessSettings, setComputerUse } from "@/utils/server"
import { showToast } from "@/utils/toast"
import {
  computerUseByHarness,
  computerUseNotice,
  grantRows,
  installCommand,
  type ComputerUseState,
} from "./project-computer-use-model"

/**
 * Computer use for the Project (#333, variant B): off by default; on, threads in the Project's folder get the Cua
 * Driver, which sees and drives the whole desktop in the background. Codex and Claude Code use their own.
 */
export function ProjectComputerUse(props: { folder: string | undefined }) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  const [state, { mutate }] = createResource(
    () => props.folder,
    (folder) => getComputerUse(server(), folder).catch(() => undefined),
  )
  const [harnesses] = createResource(
    () => props.folder,
    (folder) =>
      listHarnessSettings(server(), folder).catch(() => [] as Awaited<ReturnType<typeof listHarnessSettings>>),
  )
  const byHarness = createMemo(() =>
    computerUseByHarness(
      (harnesses.latest ?? [])
        .filter((entry) => entry.enabled)
        .map((entry) => ({ id: String(entry.id), name: entry.name, driver: String(entry.driver) })),
    ),
  )
  // Switching off doesn't cut a thread off mid-action: its next desktop action is refused, and the card says so.
  const [turnedOff, setTurnedOff] = createSignal(false)
  const toggle = (enabled: boolean) => {
    const folder = props.folder
    if (!folder) return
    void setComputerUse(server(), folder, enabled).then(
      (next: ComputerUseState) => {
        mutate(next)
        setTurnedOff(!enabled)
      },
      (error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
    )
  }
  return (
    <Show when={state.latest}>
      {(current) => (
        <section
          data-component="project-computer-use"
          class="flex flex-col gap-2 rounded-[16px] bg-v2-background-bg-layer-01 p-4 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
        >
          <div class="flex items-center gap-3">
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="type-section text-v2-text-text-base">{language.t("secondBrain.computerUse.title")}</span>
              <span class="type-meta text-v2-text-text-muted">
                {(current().stopped ?? 0) > 0
                  ? // Stop on the pill ended these threads' use of the desktop (3B); the next action of each is told so.
                    language.plural("secondBrain.computerUse.stoppedThreads", current().stopped ?? 0, {
                      count: current().stopped ?? 0,
                    })
                  : language.t(
                      turnedOff() && !current().enabled
                        ? "secondBrain.computerUse.turnedOff"
                        : "secondBrain.computerUse.description",
                    )}
              </span>
            </div>
            <ToggleSwitch checked={current().enabled} hideLabel onChange={toggle}>
              {language.t("secondBrain.computerUse.title")}
            </ToggleSwitch>
          </div>
          <Show when={computerUseNotice(current()) === "install"}>
            <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.computerUse.install")}</p>
            <code class="select-all break-all rounded-[10px] bg-v2-background-bg-base px-2.5 py-1.5 font-mono text-[11px] text-v2-text-text-base">
              {installCommand(current().platform)}
            </code>
          </Show>
          {/* macOS asks for two grants under the driver's own name; each row says where it stands. */}
          <Show when={current().enabled && current().platform === "darwin" && current().installed}>
            <div class="flex flex-col divide-y divide-v2-border-border-muted">
              <For each={grantRows(current())}>
                {(row) => (
                  <div class="flex min-h-10 items-center gap-2 py-1.5">
                    <span class="min-w-0 flex-1 type-body-compact text-v2-text-text-base">{language.t(row.label)}</span>
                    <Show
                      when={!row.granted}
                      fallback={
                        <span class="type-meta text-v2-text-text-muted">
                          {language.t("secondBrain.computerUse.granted")}
                        </span>
                      }
                    >
                      <ButtonV2 size="small" variant="tonal" onClick={() => platform.openExternal(row.settings)}>
                        {language.t("secondBrain.computerUse.openPrivacy")}
                      </ButtonV2>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={current().enabled && current().installed && current().platform === "win32"}>
            <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.computerUse.windows")}</p>
          </Show>
          <Show when={computerUseNotice(current()) === "permissions"}>
            <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.computerUse.permissions")}</p>
            <code class="select-all rounded-[10px] bg-v2-background-bg-base px-2.5 py-1.5 font-mono text-[11px] text-v2-text-text-base">
              cua-driver permissions grant
            </code>
          </Show>
          <div class="flex flex-col">
            <span class="type-body-compact text-v2-text-text-base">
              {language.t("secondBrain.computerUse.byHarness")}
            </span>
            <span class="type-meta text-v2-text-text-muted">
              {[
                byHarness().own.length > 0
                  ? language.t("secondBrain.computerUse.own", { names: byHarness().own.join(", ") })
                  : "",
                language.t("secondBrain.computerUse.tenons", { names: byHarness().tenon.join(", ") }),
                byHarness().none.length > 0
                  ? language.t("secondBrain.computerUse.none", { names: byHarness().none.join(", ") })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </section>
      )}
    </Show>
  )
}
