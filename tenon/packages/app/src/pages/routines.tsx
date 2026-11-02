import { A } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame, PageHeader } from "@/components/page"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { modelChoice } from "@/features/command-centre/command-centre"
import { listRoutines, runRoutine } from "@/features/second-brain/client"

/**
 * Routines: vault pages under `Routines/` with a `schedule` property. Each row shows the schedule, last and
 * next run, and Run now starts a Command Centre thread with the routine's prompt.
 */
export default function RoutinesPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const [state, setState] = createStore({ running: {} as Record<string, boolean>, failed: false })
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })
  const workspace = () => layout.home.workspace() ?? undefined
  const [routines, { refetch }] = createResource(workspace, (directory) => listRoutines(client(directory)))
  const time = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(language.intl(), { dateStyle: "medium", timeStyle: "short" })
      : language.t("secondBrain.routines.never")

  const run = async (id: string) => {
    const directory = workspace()
    if (!directory) return
    setState({ failed: false })
    setState("running", id, true)
    await runRoutine(client(directory), id, modelChoice(settings.commandCentre.current().modelID))
      .then(() => refetch())
      .catch(() => setState("failed", true))
    setState("running", id, false)
  }

  return (
    <PageFrame labelledBy="routines-title" class="flex flex-col">
      <PageHeader
        id="routines-title"
        title={language.t("secondBrain.routines.title")}
        actions={
          <A
            href="/command"
            class="rounded-full px-3 py-1.5 text-[13px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
          >
            {language.t("secondBrain.commandCentre.title")}
          </A>
        }
      />
      <div class="px-6 pb-6">
        <Show when={state.failed}>
          <p role="alert" class="pb-2 text-[12px] text-v2-text-text-critical">
            {language.t("common.requestFailed")}
          </p>
        </Show>
        <Show
          when={(routines.latest ?? []).length > 0}
          fallback={
            <Show when={!routines.loading}>
              <PageEmpty title={language.t("secondBrain.routines.empty.title")}>
                {language.t("secondBrain.routines.empty.body")}
              </PageEmpty>
            </Show>
          }
        >
          <table class="w-full border-separate border-spacing-y-1 text-left text-[13px]">
            <thead class="text-[12px] text-v2-text-text-muted">
              <tr>
                <th class="px-3 py-1 [font-weight:500]">{language.t("secondBrain.routines.column.name")}</th>
                <th class="px-3 py-1 [font-weight:500]">{language.t("secondBrain.routines.column.schedule")}</th>
                <th class="px-3 py-1 [font-weight:500]">{language.t("secondBrain.routines.column.lastRun")}</th>
                <th class="px-3 py-1 [font-weight:500]">{language.t("secondBrain.routines.column.nextRun")}</th>
                <th class="px-3 py-1">
                  <span class="sr-only">{language.t("secondBrain.routines.column.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={routines.latest ?? []}>
                {(routine) => (
                  <tr class="text-v2-text-text-base" data-routine={routine.id}>
                    <td class="px-3 py-2">
                      {routine.name}
                      <Show when={!routine.enabled}>
                        <span class="ml-2 text-[11px] text-v2-text-text-faint">
                          {language.t("secondBrain.routines.disabled")}
                        </span>
                      </Show>
                    </td>
                    <td class="px-3 py-2 font-mono text-[12px] text-v2-text-text-muted">{routine.schedule}</td>
                    <td class="px-3 py-2 text-v2-text-text-muted">
                      {time(routine.lastRun)}
                      <Show when={routine.lastStatus === "failed"}>
                        <span class="ml-2 text-v2-text-text-critical">{language.t("secondBrain.routines.failed")}</span>
                      </Show>
                    </td>
                    <td class="px-3 py-2 text-v2-text-text-muted">{routine.enabled ? time(routine.nextRun) : "—"}</td>
                    <td class="px-3 py-2 text-right">
                      <ButtonV2
                        size="small"
                        variant="tonal"
                        disabled={state.running[routine.id] === true}
                        onClick={() => void run(routine.id)}
                      >
                        {language.t("secondBrain.routines.runNow")}
                      </ButtonV2>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </PageFrame>
  )
}
