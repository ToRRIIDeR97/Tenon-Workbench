import { A, useNavigate } from "@solidjs/router"
import { useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Switch } from "@tenon/ui/v2/switch-v2"
import { createEffect, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame, PageHeader } from "@/components/page"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { modelChoice } from "@/features/command-centre/command-centre"
import {
  approveRoutine,
  listRoutines,
  runRoutine,
  SecondBrainRequestError,
  setRoutineEnabled,
  writeVaultPage,
  type Routine,
} from "@/features/second-brain/client"
import { invalidateVaultPages } from "@/features/second-brain/vault-pages"
import { settled } from "@/utils/resource"
import { sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"

/**
 * Routines: vault pages under `Routines/` with a `schedule` property. Each row shows the schedule, last and
 * next run, and Run now starts a Command Centre thread with the routine's prompt. A page runs only once
 * approved, and again after any change to what it would run; the row links to the page to read first. New
 * routine writes a `Routines/` page from a template (switched off until ready) and opens it on the Projects
 * page. A row's name opens its page and its switch turns the schedule on or off.
 */
export default function RoutinesPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    running: {} as Record<string, boolean>,
    toggling: {} as Record<string, boolean>,
    failed: false,
    creating: false,
  })
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })
  const workspace = () => layout.home.workspace() ?? undefined
  // A failed list shows inline instead of throwing into the error boundary.
  const [routines, { refetch }] = createResource(workspace, (directory) =>
    listRoutines(client(directory)).then(
      (items) => ({ items, failed: false }),
      () => ({ items: [] as Routine[], failed: true }),
    ),
  )
  const items = (): ReadonlyArray<Routine & { unsupported?: ReadonlyArray<string> }> => settled(routines)?.items ?? []
  // A run ends on the server, so the list is re-read while one is in flight.
  createEffect(() => {
    if (!items().some((routine) => routine.lastStatus === "running")) return
    const timer = setInterval(() => void refetch(), 15_000)
    onCleanup(() => clearInterval(timer))
  })
  const time = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(language.intl(), { dateStyle: "medium", timeStyle: "short" })
      : language.t("secondBrain.routines.never")

  const run = async (routine: Routine) => {
    const directory = workspace()
    if (!directory) return
    setState({ failed: false })
    setState("running", routine.id, true)
    await runRoutine(client(directory), routine.id, modelChoice(settings.commandCentre.current().modelID))
      .then((result) => {
        showToast({
          title: language.t("secondBrain.routines.started"),
          description: routine.name,
          actions: [
            {
              label: language.t("secondBrain.routines.openThread"),
              onClick: () => navigate(sessionHref(server.key, result.threadId)),
            },
          ],
        })
      })
      .catch((error: unknown) => {
        // Already running or no longer approved: the refreshed row says so.
        if (!(error instanceof SecondBrainRequestError && error.status === 409)) setState("failed", true)
      })
      .then(() => refetch())
    setState("running", routine.id, false)
  }

  const setEnabled = async (routine: Routine, enabled: boolean) => {
    const directory = workspace()
    if (!directory) return
    setState({ failed: false })
    setState("toggling", routine.id, true)
    await setRoutineEnabled(client(directory), routine.path, enabled)
      .then(() => {
        void invalidateVaultPages(queryClient, server.key)
        return refetch()
      })
      .catch(() => setState("failed", true))
    setState("toggling", routine.id, false)
  }

  // A page changed since this list was read stays unapproved; the refetch shows its new content's state.
  const approve = async (routine: Routine) => {
    const directory = workspace()
    if (!directory) return
    setState({ failed: false })
    setState("running", routine.id, true)
    await approveRoutine(client(directory), routine.id, routine.hash).catch(() => setState("failed", true))
    await refetch()
    setState("running", routine.id, false)
  }

  // Routines are pages under `Routines/` whose properties carry a `schedule`; the template starts switched off.
  const create = async () => {
    const directory = workspace()
    if (!directory || state.creating) return
    setState({ creating: true, failed: false })
    const name = language.t("secondBrain.routines.new.name")
    const write = (attempt: number): Promise<string | undefined> => {
      const title = attempt === 1 ? name : `${name} ${attempt}`
      return writeVaultPage(client(directory), {
        path: `Routines/${title}.md`,
        title,
        body: language.t("secondBrain.routines.new.body"),
        properties: {
          schedule: "daily 08:00",
          enabled: false,
          model: settings.commandCentre.current().modelID ?? "",
        },
        create: true,
      }).then(
        (page) => page.info.path,
        (error: unknown) =>
          error instanceof SecondBrainRequestError && error.status === 409 && attempt < 20
            ? write(attempt + 1)
            : undefined,
      )
    }
    const path = await write(1)
    setState("creating", false)
    if (!path) return setState("failed", true)
    void invalidateVaultPages(queryClient, server.key)
    navigate(`/projects?page=${encodeURIComponent(path)}`)
  }

  return (
    <PageFrame labelledBy="routines-title" class="flex flex-col">
      <PageHeader
        id="routines-title"
        title={language.t("secondBrain.routines.title")}
        actions={
          <>
            <A
              href="/command"
              class="rounded-full px-3 py-1.5 text-[13px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
            >
              {language.t("secondBrain.commandCentre.title")}
            </A>
            <ButtonV2
              size="small"
              variant="tonal"
              disabled={!workspace() || state.creating}
              onClick={() => void create()}
            >
              {language.t("secondBrain.routines.new")}
            </ButtonV2>
          </>
        }
      />
      <div class="px-6 pb-6">
        <Show when={state.failed || settled(routines)?.failed}>
          <p role="alert" class="pb-2 text-[12px] text-v2-text-text-critical">
            {language.t("common.requestFailed")}
          </p>
        </Show>
        <Show
          when={items().length > 0}
          fallback={
            <Show when={!routines.loading && !settled(routines)?.failed}>
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
              <For each={items()}>
                {(routine) => (
                  <tr class="text-v2-text-text-base" data-routine={routine.id}>
                    <td class="px-3 py-2">
                      <A href={`/projects?page=${encodeURIComponent(routine.path)}`} class="hover:underline">
                        {routine.name}
                      </A>
                      <Show when={!routine.enabled}>
                        <span class="ml-2 text-[11px] text-v2-text-text-faint">
                          {language.t("secondBrain.routines.disabled")}
                        </span>
                      </Show>
                      {/* `harness` and `tools` are read from the page but runs don't honour them yet. */}
                      <Show when={(routine.unsupported ?? []).length > 0}>
                        <span class="block text-[11px] text-v2-text-text-faint">
                          {language.t("secondBrain.routines.unsupported", {
                            fields: (routine.unsupported ?? []).join(", "),
                          })}
                        </span>
                      </Show>
                      <Show when={routine.needsApproval}>
                        <span class="block text-[11px] text-v2-text-text-muted">
                          {language.t("secondBrain.routines.needsApproval")}
                          {" · "}
                          <A href={`/projects?page=${encodeURIComponent(routine.path)}`} class="underline">
                            {language.t("secondBrain.routines.review")}
                          </A>
                        </span>
                      </Show>
                      <Show when={(routine.denied ?? []).length > 0}>
                        <span class="block text-[11px] text-v2-text-text-faint">
                          {language.t("secondBrain.routines.denied", {
                            permissions: (routine.denied ?? []).join(", "),
                          })}
                        </span>
                      </Show>
                    </td>
                    <td class="px-3 py-2 font-mono text-[12px] text-v2-text-text-muted">{routine.schedule}</td>
                    <td class="px-3 py-2 text-v2-text-text-muted">
                      {time(routine.lastRun)}
                      <Show when={routine.lastStatus === "failed"}>
                        <span class="ml-2 text-v2-text-text-critical">{language.t("secondBrain.routines.failed")}</span>
                      </Show>
                      <Show when={routine.lastStatus === "unfiled"}>
                        <span class="ml-2 text-v2-text-text-critical">
                          {language.t("secondBrain.routines.unfiled")}
                        </span>
                      </Show>
                      <Show when={routine.lastStatus === "running"}>
                        <span class="ml-2">{language.t("secondBrain.routines.running")}</span>
                      </Show>
                    </td>
                    <td class="px-3 py-2 text-v2-text-text-muted">{routine.enabled ? time(routine.nextRun) : "—"}</td>
                    <td class="px-3 py-2">
                      <div class="flex items-center justify-end gap-3">
                        <Switch
                          hideLabel
                          size="small"
                          checked={routine.enabled}
                          disabled={state.toggling[routine.id] === true}
                          onChange={(enabled) => void setEnabled(routine, enabled)}
                        >
                          {language.t("secondBrain.routines.enable", { name: routine.name })}
                        </Switch>
                        <ButtonV2
                          size="small"
                          variant="tonal"
                          disabled={
                            state.running[routine.id] === true ||
                            (!routine.needsApproval && routine.lastStatus === "running")
                          }
                          onClick={() => void (routine.needsApproval ? approve(routine) : run(routine))}
                        >
                          {language.t(
                            routine.needsApproval ? "secondBrain.routines.approve" : "secondBrain.routines.runNow",
                          )}
                        </ButtonV2>
                      </div>
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
