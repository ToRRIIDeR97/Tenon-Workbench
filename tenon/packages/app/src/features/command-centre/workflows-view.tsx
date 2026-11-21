import { useQuery } from "@tanstack/solid-query"
import { Harness } from "@tenon/schema/harness"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { Reveal } from "@tenon/ui/v2/reveal"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { HarnessIcon } from "@/components/harness-icon"
import { harnessSettingsVersion, MODEL_RETRIES, MODEL_RETRY_MS } from "@/components/prompt-input/harness-controller"
import { harnessStatusKey, orderHarnesses } from "@/components/prompt-input/harness-controls"
import type { SidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, withVisibleModels } from "@/context/settings"
import { modelChoice, useCommandCentre } from "@/features/command-centre/command-centre"
import { duplicateWorkflow, newRun, workflowID, useWorkflows } from "@/features/command-centre/workflow-store"
import { WorkflowRunList, WorkflowRunView } from "@/features/command-centre/workflow-run-view"
import {
  DEFAULT_WORKFLOWS,
  directorBrief,
  MAX_ROUNDS,
  validateWorkflow,
  type RoleMay,
  type Workflow,
  type WorkflowProblem,
  type WorkflowRole,
} from "@/features/command-centre/workflows"
import { Identifier } from "@/utils/id"
import { listHarnessesRemembered, rememberedHarnesses } from "@/utils/server"

const chipClass =
  "flex h-7 min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-02 px-2.5 text-[12px] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-03 data-[expanded]:bg-v2-background-bg-layer-03 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus disabled:text-v2-text-text-disabled motion-reduce:transition-none"
// Text that reads as text until hovered or focused: names and descriptions edit in place, with no field border.
const quietClass =
  "min-w-0 rounded-[8px] bg-transparent px-1.5 -mx-1.5 text-v2-text-text-base outline-none transition-colors duration-short ease-standard placeholder:text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus:bg-v2-background-bg-layer-02 focus:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)] motion-reduce:transition-none"
// A borderless field on a tonal fill, for the longer text a role unfolds to.
const areaClass =
  "w-full min-w-0 resize-y rounded-[12px] bg-v2-background-bg-layer-01 px-3 py-2 text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-muted focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
// One list surface with hairlines between its rows, as Settings lists are.
const listClass =
  "flex flex-col overflow-hidden rounded-[16px] bg-v2-background-bg-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
// A number in a pill, with its label in front: the run limits.
const limitClass =
  "flex h-8 items-center gap-2 rounded-full bg-v2-background-bg-layer-02 pl-3 pr-1 text-[12px] text-v2-text-text-muted focus-within:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
const limitInputClass =
  "h-6 w-20 min-w-0 rounded-full bg-v2-background-bg-base px-2 text-right text-[12px] tabular-nums text-v2-text-text-base outline-none placeholder:text-v2-text-text-muted [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
const mays: RoleMay[] = ["direct", "edit", "read"]

type Choice = { id: string; label: string; detail?: string; disabled?: boolean; icon?: Harness.Instance }

/** A chip that opens a menu of choices, for the harness, model, "may do" and Project pickers. */
function PickChip(props: {
  action: string
  label: string
  value: string
  current: string
  choices: Choice[]
  onPick: (id: string) => void
  icon?: Harness.Instance
}) {
  return (
    <MenuV2 gutter={4} modal={false} placement="bottom-start">
      <MenuV2.Trigger as="button" type="button" class={chipClass} aria-label={props.label} data-action={props.action}>
        <Show when={props.icon}>{(instance) => <HarnessIcon instance={instance()} />}</Show>
        <span class="min-w-0 truncate">{props.value}</span>
        <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="max-h-[min(360px,50vh)] overflow-y-auto">
          <MenuV2.RadioGroup value={props.current} onChange={props.onPick}>
            <For each={props.choices}>
              {(choice) => (
                // A choice closes the menu: it would otherwise cover the chips of the role below.
                <MenuV2.RadioItem value={choice.id} disabled={choice.disabled} closeOnSelect>
                  <span class="flex min-w-0 items-center gap-2">
                    <Show when={choice.icon}>{(instance) => <HarnessIcon instance={instance()} />}</Show>
                    <span class="min-w-0 truncate">{choice.label}</span>
                    <Show when={choice.detail}>
                      <span class="shrink-0 text-v2-text-text-muted">{choice.detail}</span>
                    </Show>
                  </span>
                </MenuV2.RadioItem>
              )}
            </For>
          </MenuV2.RadioGroup>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

/**
 * The harnesses the composer offers, from the same check (`listHarnessesRemembered`) and with the same hidden
 * models left out. Undefined until the first answer.
 */
function createHarnessList(directory: () => string) {
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const query = useQuery(() => ({
    // A harness added, toggled or removed in Settings changes the key, so the list is asked again as the composer's is.
    queryKey: ["workflows", "harnesses", server.key, directory(), harnessSettingsVersion()],
    enabled: !!directory(),
    queryFn: () => listHarnessesRemembered({ server: serverSDK().server.http, fetch: platform.fetch }, directory()),
    placeholderData: () => rememberedHarnesses(serverSDK().server.http.url, directory()),
    staleTime: 30_000,
    retry: MODEL_RETRIES,
    retryDelay: MODEL_RETRY_MS,
  }))
  // Reading `data` while pending suspends, and a failed check throws; neither belongs in this page.
  return createMemo(() => {
    if (query.isPending || query.isError) return undefined
    const list = query.data?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    )
    return orderHarnesses(list)
  })
}

/**
 * The Command Centre's Workflows view: saved role setups on the left; on the right the selected one (its roles
 * with a harness and model each, the run limits, a Project and a brief) and Start, which creates a director thread
 * in that Project and sends it the generated brief.
 */
export function Workflows(props: {
  ctrl: SidebarController
  started: () => void
  /** The run shown in the right pane instead of the workflow editor. */
  run?: string
  selectRun: (id: string | undefined) => void
  open: (sessionID: string) => void
  showProject: (projectID: string) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const centre = useCommandCentre()
  const store = useWorkflows()
  const harnesses = createHarnessList(() => centre.directory() ?? "")
  const [state, setState] = createStore({
    selected: undefined as string | undefined,
    project: undefined as string | undefined,
    brief: "",
    tried: false,
    starting: false,
    failed: false,
    // The role unfolded to its job; one at a time.
    open: undefined as string | undefined,
  })
  const list = createMemo(() => store.workflows())
  const run = createMemo(() => store.runs().find((item) => item.id === props.run))
  const workflow = createMemo(() => list().find((item) => item.id === state.selected) ?? list()[0])
  const builtIn = () => DEFAULT_WORKFLOWS.some((item) => item.id === workflow()?.id)
  const projects = () => props.ctrl.projects()
  const project = () => projects().find((item) => item.id === state.project)

  // Why Start would be refused, one entry per problem code, then the run's own brief and Project.
  const problems = createMemo<(WorkflowProblem | "brief" | "project")[]>(() => {
    const current = workflow()
    if (!current) return []
    return [
      ...validateWorkflow(current),
      ...(state.brief.trim() ? [] : (["brief"] as const)),
      ...(project() ? [] : (["project"] as const)),
    ]
  })
  const problemText = (problem: WorkflowProblem | "brief" | "project") =>
    problem === "name"
      ? language.t("secondBrain.workflows.problem.name")
      : problem === "roles"
        ? language.t("secondBrain.workflows.problem.roles")
        : problem === "director"
          ? language.t("secondBrain.workflows.problem.director")
          : problem === "role"
            ? language.t("secondBrain.workflows.problem.role")
            : problem === "rounds"
              ? language.t("secondBrain.workflows.problem.rounds", { max: MAX_ROUNDS })
              : problem === "budget"
                ? language.t("secondBrain.workflows.problem.budget")
                : problem === "brief"
                  ? language.t("secondBrain.workflows.problem.brief")
                  : language.t("secondBrain.workflows.problem.project")

  const update = (patch: Partial<Workflow>) => {
    const current = workflow()
    if (current) store.save({ ...current, ...patch })
  }
  const updateRole = (id: string, patch: Partial<WorkflowRole>) =>
    update({ roles: workflow()?.roles.map((role) => (role.id === id ? { ...role, ...patch } : role)) ?? [] })
  const addRole = () => {
    const roles = workflow()?.roles ?? []
    const id = workflowID("role")
    // A new role opens, so its job can be written straight away.
    setState("open", id)
    update({
      roles: [
        ...roles,
        {
          id,
          name: language.t("secondBrain.workflows.role.newName", { number: roles.length + 1 }),
          job: "",
          harnessID: "",
          may: roles.length === 0 ? "direct" : "edit",
        },
      ],
    })
  }
  const create = () => {
    const made: Workflow = {
      id: workflowID("wf"),
      name: language.t("secondBrain.workflows.new.name"),
      description: "",
      roles: [
        {
          id: workflowID("role"),
          name: language.t("secondBrain.workflows.role.newName", { number: 1 }),
          job: "",
          harnessID: "",
          may: "direct",
        },
      ],
      maxRounds: 3,
    }
    store.save(made)
    setState("selected", made.id)
  }
  const duplicate = () => {
    const current = workflow()
    if (!current) return
    const copy = duplicateWorkflow(
      current,
      workflowID("wf"),
      language.t("secondBrain.workflows.copyName", { name: current.name }),
    )
    store.save(copy)
    setState("selected", copy.id)
  }
  const remove = () => {
    const current = workflow()
    if (!current || builtIn()) return
    store.remove(current.id)
    setState("selected", undefined)
  }

  // The new thread runs in the Project's thread folder on the director's harness and model, as the Command
  // Centre's own composer starts one; nothing is recorded unless the brief was sent.
  const start = () => {
    const current = workflow()
    const target = project()
    setState("tried", true)
    if (!current || !target || problems().length > 0 || state.starting) return
    const director = current.roles[0]
    const harnessID = Harness.InstanceID.make(director.harnessID)
    const external = harnessID !== Harness.OpenCode
    const harnessModel = director.modelID ? { id: director.modelID } : undefined
    const model = external ? undefined : modelChoice(director.modelID)
    const directory = target.threadDirectory
    setState({ starting: true, failed: false })
    void (async () => {
      const info = await serverSDK().api.session.create({
        harnessInstanceID: harnessID,
        harnessModel: external ? harnessModel : undefined,
        location: { directory },
      })
      if (!info?.id) throw new Error("workflow_thread_failed")
      await serverSDK()
        .ensureDirSdkContext(directory)
        .api.session.prompt({
          sessionID: info.id,
          id: Identifier.ascending("message"),
          text: directorBrief(current, state.brief),
          harness: external,
          ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
        })
        .catch(async (error: unknown) => {
          // Don't leave an empty director thread behind.
          await serverSDK()
            .api.session.remove({ sessionID: info.id, directory })
            .catch(() => undefined)
          throw error
        })
      return info.id
    })().then(
      (sessionID) => {
        store.addRun(
          newRun({
            id: workflowID("run"),
            workflow: current,
            sessionID,
            project: target.id,
            startedAt: Date.now(),
          }),
        )
        props.ctrl.retryProjects()
        setState({ starting: false, brief: "", tried: false })
        props.started()
      },
      () => setState({ starting: false, failed: true }),
    )
  }

  const harnessChoices = (): Choice[] =>
    (harnesses() ?? []).map((item) => ({
      id: item.id,
      label: item.name,
      detail: harnessStatusKey(item) ? language.t(harnessStatusKey(item)!) : undefined,
      disabled: item.status === "unavailable",
      icon: item,
    }))

  // One row per role: its number, name, what it may do and what it runs on; the job shows on one line and unfolds to
  // edit, with what the role may do spelled out.
  const RoleRow = (row: { id: string; number: number }) => (
    <Show when={workflow()?.roles.find((role) => role.id === row.id)}>
      {(role) => {
        const instance = () => harnesses()?.find((item) => item.id === role().harnessID)
        const external = () => !!instance() && instance()!.driver !== Harness.OpenCodeDriver
        const open = () => state.open === role().id
        const toggle = () => setState("open", open() ? undefined : role().id)
        const modelName = () =>
          instance()?.models.find((model) => model.id === role().modelID)?.name ??
          role().modelID ??
          language.t("secondBrain.workflows.role.modelDefault")
        return (
          <li
            data-role={role().id}
            data-open={open() ? "" : undefined}
            class="flex flex-col"
            classList={{ "border-t border-v2-border-border-muted": row.number > 1 }}
          >
            <div class="flex min-w-0 items-start gap-3 py-3 pl-3.5 pr-2">
              <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 type-caption tabular-nums text-v2-text-text-base">
                {row.number}
              </span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <input
                    class={`${quietClass} h-7 min-w-16 max-w-full [field-sizing:content] type-row-title [font-weight:600]`}
                    value={role().name}
                    aria-label={language.t("secondBrain.workflows.role.name", { number: row.number })}
                    onInput={(event) => updateRole(role().id, { name: event.currentTarget.value })}
                  />
                  <PickChip
                    action="workflow-role-may"
                    label={language.t("secondBrain.workflows.role.may", { name: role().name })}
                    value={language.t(`secondBrain.workflows.may.${role().may}`)}
                    current={role().may}
                    choices={mays.map((may) => ({ id: may, label: language.t(`secondBrain.workflows.may.${may}`) }))}
                    onPick={(id) => updateRole(role().id, { may: mays.find((may) => may === id) ?? role().may })}
                  />
                  <span class="flex-1" />
                  <PickChip
                    action="workflow-role-harness"
                    label={language.t("secondBrain.workflows.role.harness", { name: role().name })}
                    value={
                      instance()?.name ?? (role().harnessID || language.t("secondBrain.workflows.role.harnessNone"))
                    }
                    icon={instance()}
                    current={role().harnessID}
                    choices={harnessChoices()}
                    // A new harness starts on its default model: the old one may not exist there.
                    onPick={(id) => updateRole(role().id, { harnessID: id, modelID: undefined })}
                  />
                  <Show when={external()}>
                    <PickChip
                      action="workflow-role-model"
                      label={language.t("secondBrain.workflows.role.model", { name: role().name })}
                      value={modelName()}
                      current={role().modelID ?? ""}
                      choices={[
                        { id: "", label: language.t("secondBrain.workflows.role.modelDefault") },
                        ...(instance()?.models.map((model) => ({ id: model.id, label: model.name })) ?? []),
                      ]}
                      onPick={(id) => updateRole(role().id, { modelID: id || undefined })}
                    />
                  </Show>
                </div>
                <Show when={!open()}>
                  <button
                    type="button"
                    tabIndex={-1}
                    class="min-w-0 truncate text-left type-meta text-v2-text-text-muted"
                    onClick={toggle}
                  >
                    {role().job || language.t("secondBrain.workflows.role.jobPlaceholder")}
                  </button>
                </Show>
              </div>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                class="mt-0.5"
                data-action="workflow-role-toggle"
                aria-expanded={open()}
                aria-label={language.t("secondBrain.workflows.role.details", { name: role().name })}
                icon={
                  <Icon
                    name="chevron-down"
                    size="small"
                    class="transition-transform duration-medium ease-emphasized-decelerate motion-reduce:transition-none"
                    classList={{ "rotate-180": open() }}
                  />
                }
                onClick={toggle}
              />
            </div>
            <Reveal open={open()} variant="even">
              <div class="flex flex-col gap-2.5 pb-3.5 pl-[50px] pr-3.5">
                <textarea
                  class={areaClass}
                  rows={3}
                  value={role().job}
                  aria-label={language.t("secondBrain.workflows.role.job", { name: role().name })}
                  placeholder={language.t("secondBrain.workflows.role.jobPlaceholder")}
                  onInput={(event) => updateRole(role().id, { job: event.currentTarget.value })}
                />
                <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <p class="min-w-0 flex-1 type-meta text-v2-text-text-muted">
                    {language.t(`secondBrain.workflows.may.${role().may}.line`)}
                    <Show when={role().harnessID && !external()}>
                      {" "}
                      {language.t("secondBrain.workflows.role.modelBuiltIn")}
                    </Show>
                  </p>
                  <ButtonV2
                    size="small"
                    variant="ghost"
                    data-action="workflow-remove-role"
                    aria-label={language.t("secondBrain.workflows.role.remove", { name: role().name })}
                    onClick={() => update({ roles: workflow()?.roles.filter((item) => item.id !== role().id) ?? [] })}
                  >
                    {language.t("common.delete")}
                  </ButtonV2>
                </div>
              </div>
            </Reveal>
          </li>
        )
      }}
    </Show>
  )

  return (
    <section
      data-component="workflows"
      aria-labelledby="workflows-title"
      class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[max-content_minmax(min(600px,85vh),1fr)] gap-2 overflow-y-auto @[900px]:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] @[900px]:grid-rows-[minmax(0,1fr)] @[900px]:overflow-hidden"
    >
      <aside class="flex min-h-0 min-w-0 flex-col gap-2 rounded-[16px] bg-v2-background-bg-layer-01 p-4 @[900px]:overflow-y-auto">
        <h2 id="workflows-title" class="px-1 pb-1 type-section text-v2-text-text-base">
          {language.t("secondBrain.workflows.title")}
        </h2>
        <ul class="flex flex-col gap-0.5" aria-label={language.t("secondBrain.workflows.list")}>
          <For each={list().map((item) => item.id)}>
            {(id) => (
              <Show when={list().find((item) => item.id === id)}>
                {(item) => (
                  <li>
                    <button
                      type="button"
                      data-workflow={item().id}
                      aria-current={workflow()?.id === item().id && !run() ? "true" : undefined}
                      class="flex w-full min-w-0 flex-col gap-0.5 rounded-[12px] px-3 py-2 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                      classList={{
                        "bg-v2-overlay-simple-overlay-pressed": workflow()?.id === item().id && !run(),
                      }}
                      onClick={() => {
                        props.selectRun(undefined)
                        setState({ selected: item().id, failed: false })
                      }}
                    >
                      <span class="w-full min-w-0 truncate type-row-title [font-weight:600] text-v2-text-text-base">
                        {item().name || language.t("secondBrain.workflows.new.name")}
                      </span>
                      <span class="w-full min-w-0 truncate type-meta text-v2-text-text-muted">
                        {language.plural("secondBrain.workflows.roleCount", item().roles.length)}
                      </span>
                    </button>
                  </li>
                )}
              </Show>
            )}
          </For>
        </ul>
        <div>
          <ButtonV2 size="small" variant="ghost" icon="plus" data-action="workflow-new" onClick={create}>
            {language.t("secondBrain.workflows.new")}
          </ButtonV2>
        </div>
        <div class="pt-3">
          <WorkflowRunList ctrl={props.ctrl} selected={props.run} select={props.selectRun} />
        </div>
      </aside>
      <div class="@container/main flex min-h-0 min-w-0 flex-col rounded-[16px] bg-v2-background-bg-layer-01 @[900px]:overflow-hidden">
        <Show
          when={run()}
          fallback={
            <Show when={workflow()}>
              {(current) => (
                <>
                  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-5">
                    <div class="flex min-w-0 items-start gap-3">
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <input
                          class={`${quietClass} h-8 w-full type-toolbar-title`}
                          value={current().name}
                          aria-label={language.t("secondBrain.workflows.name")}
                          onInput={(event) => update({ name: event.currentTarget.value })}
                        />
                        <input
                          class={`${quietClass} h-7 w-full type-meta !text-v2-text-text-muted`}
                          value={current().description}
                          aria-label={language.t("secondBrain.workflows.description")}
                          placeholder={language.t("secondBrain.workflows.description")}
                          onInput={(event) => update({ description: event.currentTarget.value })}
                        />
                      </div>
                      <div class="flex shrink-0 items-center gap-1 pt-0.5">
                        <ButtonV2 size="small" variant="ghost" data-action="workflow-duplicate" onClick={duplicate}>
                          {language.t("secondBrain.workflows.duplicate")}
                        </ButtonV2>
                        <Show when={!builtIn()}>
                          <ButtonV2 size="small" variant="ghost" data-action="workflow-delete" onClick={remove}>
                            {language.t("common.delete")}
                          </ButtonV2>
                        </Show>
                      </div>
                    </div>
                    <section class="flex flex-col gap-2" aria-labelledby="workflow-roles-title">
                      <h3 id="workflow-roles-title" class="px-1 type-section text-v2-text-text-base">
                        {language.t("secondBrain.workflows.roles")}
                      </h3>
                      <ol class={listClass}>
                        <For each={current().roles.map((role) => role.id)}>
                          {(id, index) => <RoleRow id={id} number={index() + 1} />}
                        </For>
                        <li classList={{ "border-t border-v2-border-border-muted": current().roles.length > 0 }}>
                          <button
                            type="button"
                            data-action="workflow-add-role"
                            class="flex w-full items-center gap-3 px-3.5 py-3 text-left type-row-title text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                            onClick={addRole}
                          >
                            <span class="flex size-6 shrink-0 items-center justify-center">
                              <Icon name="plus" size="small" />
                            </span>
                            {language.t("secondBrain.workflows.role.add")}
                          </button>
                        </li>
                      </ol>
                    </section>
                    <section class="flex flex-col gap-2" aria-labelledby="workflow-run-title">
                      <h3 id="workflow-run-title" class="px-1 type-section text-v2-text-text-base">
                        {language.t("secondBrain.workflows.run")}
                      </h3>
                      <div class={`${listClass} !flex-row flex-wrap items-center gap-2 px-3.5 py-3`}>
                        <p class="mr-auto min-w-0 basis-full type-meta text-v2-text-text-muted @[620px]/main:basis-auto">
                          {language.t("secondBrain.workflows.limits.hint")}
                        </p>
                        <label class={limitClass}>
                          {language.t("secondBrain.workflows.rounds")}
                          <input
                            type="number"
                            min="1"
                            max={MAX_ROUNDS}
                            step="1"
                            data-slot="workflow-rounds"
                            class={limitInputClass}
                            value={Number.isFinite(current().maxRounds) ? current().maxRounds : ""}
                            onInput={(event) => update({ maxRounds: event.currentTarget.valueAsNumber })}
                          />
                        </label>
                        <label class={limitClass}>
                          {language.t("secondBrain.workflows.budget")}
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            data-slot="workflow-budget"
                            class={limitInputClass}
                            value={current().budgetUSD ?? ""}
                            placeholder={language.t("secondBrain.workflows.budget.placeholder")}
                            onInput={(event) =>
                              update({
                                budgetUSD:
                                  event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber,
                              })
                            }
                          />
                        </label>
                      </div>
                    </section>
                  </div>
                  {/* The run stays docked under the setup: what's still missing, the brief, where it starts and Start. */}
                  <div class="flex shrink-0 flex-col gap-2 border-t border-v2-border-border-muted px-6 pb-5 pt-3">
                    <Reveal open={problems().length > 0} variant="line">
                      <ul
                        data-slot="workflow-problems"
                        aria-label={language.t("secondBrain.workflows.problems")}
                        class="flex flex-wrap gap-x-4 gap-y-1 px-1 type-meta"
                        classList={{
                          "text-v2-text-text-critical": state.tried,
                          "text-v2-text-text-muted": !state.tried,
                        }}
                      >
                        <For each={problems()}>
                          {(problem) => (
                            <li
                              data-problem={problem}
                              role={state.tried ? "alert" : undefined}
                              class="flex min-w-0 items-center gap-1.5"
                            >
                              <span
                                aria-hidden="true"
                                class="size-3 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_currentColor] opacity-70"
                              />
                              {problemText(problem)}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Reveal>
                    <div class="flex flex-col rounded-[20px] bg-v2-background-bg-raised shadow-[0_0_0_1px_var(--v2-border-border-base),0_8px_24px_-12px_rgb(0_0_0/0.14)] transition-shadow duration-short ease-standard focus-within:shadow-[0_0_0_2px_var(--v2-border-border-focus),0_8px_24px_-12px_rgb(0_0_0/0.14)] motion-reduce:transition-none">
                      <textarea
                        data-slot="workflow-brief"
                        class="max-h-40 min-h-11 w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-[22px] text-v2-text-text-base outline-none [field-sizing:content] placeholder:text-v2-text-text-faint"
                        rows={1}
                        value={state.brief}
                        aria-label={language.t("secondBrain.workflows.brief")}
                        placeholder={language.t("secondBrain.workflows.brief.placeholder")}
                        onInput={(event) => setState("brief", event.currentTarget.value)}
                      />
                      <div class="flex min-w-0 items-center gap-2 pb-2 pl-3 pr-2 pt-1">
                        <PickChip
                          action="workflow-project"
                          label={language.t("secondBrain.workflows.project")}
                          value={project()?.name ?? language.t("secondBrain.workflows.project.choose")}
                          current={state.project ?? ""}
                          choices={projects().map((item) => ({ id: item.id, label: item.name }))}
                          onPick={(id) => setState("project", id)}
                        />
                        <span class="flex-1" />
                        <ButtonV2
                          size="normal"
                          variant="contrast"
                          data-action="workflow-start"
                          disabled={state.starting}
                          onClick={start}
                        >
                          {language.t("secondBrain.workflows.start")}
                        </ButtonV2>
                      </div>
                    </div>
                    <Show when={state.failed}>
                      <p role="alert" class="px-1 type-meta text-v2-text-text-critical">
                        {language.t("common.requestFailed")}
                      </p>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          }
        >
          {(selected) => (
            <div class="min-h-0 flex-1 overflow-y-auto p-5">
              <WorkflowRunView
                run={selected()}
                ctrl={props.ctrl}
                open={props.open}
                showProject={props.showProject}
                removed={() => props.selectRun(undefined)}
              />
            </div>
          )}
        </Show>
      </div>
    </section>
  )
}
