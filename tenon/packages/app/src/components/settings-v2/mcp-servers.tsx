import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { Reveal } from "@tenon/ui/v2/reveal"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { Switch as ToggleSwitch } from "@tenon/ui/v2/switch-v2"
import { TextInputV2 } from "@tenon/ui/v2/text-input-v2"
import { For, Show, createMemo, createResource, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { editMcpServer, listHarnessSettings, mcpSecretNames, mcpToolNames, removeMcpServer } from "@/utils/server"
import { showToast } from "@/utils/toast"
import { statusDotClass } from "../surface-classes"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import {
  mcpEntryFromForm,
  mcpNameProblem,
  mcpReach,
  mcpRowState,
  mcpRows,
  mcpSuggestions,
  type McpForm,
  type McpSuggestion,
} from "./mcp-servers-model"
import "./settings-v2.css"

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

type Pair = { key: string; value: string }

/**
 * Settings → MCP servers, the one place for MCP (#334, variant A). Every configured server is a row with its live
 * status, the fix in the row itself (Sign in, Retry), which harnesses receive it, and an on/off switch; a row opens
 * in place to show what it runs and to remove it. Common servers are offered below in one click (the row flies into
 * the list). Custom server opens a typed form: a command with its arguments one by one, environment, folder and
 * timeout; a URL with headers; or a pasted JSON entry.
 */
export const SettingsMcpServersV2: Component = () => {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [form, setForm] = createStore({
    open: false,
    name: "",
    kind: "local" as "local" | "remote" | "json",
    command: "",
    arg: "",
    args: [] as string[],
    env: [] as Pair[],
    cwd: "",
    timeout: "",
    url: "",
    headers: [] as Pair[],
    json: "",
    busy: false,
    /** The server just added, so only its row rises in. */
    added: "",
    /** The server being edited in place; its name is fixed and only the fields shown are saved. */
    editing: "",
  })
  const [rowState, setRowState] = createStore({
    open: {} as Record<string, boolean>,
    busy: {} as Record<string, boolean>,
    confirming: "",
    /** The row whose name is being changed in place, and the name typed so far. */
    renaming: "",
    rename: "",
  })
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  // Live status is per folder; the open workspace (or the home folder) stands in for "where agents run".
  const directory = createMemo(() => layout.home.workspace() || serverSync().data.path.home || "")
  const live = createMemo(() => {
    const dir = directory()
    return dir ? serverSync().child(dir, { mcp: true, bootstrap: false })[0] : undefined
  })
  const [harnesses] = createResource(directory, (dir) =>
    listHarnessSettings(server(), dir).catch(() => [] as Awaited<ReturnType<typeof listHarnessSettings>>),
  )
  const enabledHarnesses = createMemo(() =>
    (harnesses.latest ?? [])
      .filter((entry) => entry.enabled)
      .map((entry) => ({ name: entry.name, driver: entry.driver })),
  )
  // Tool names come from the connected servers, asked again whenever one connects or drops.
  const connected = createMemo(
    () => {
      const dir = directory()
      const statuses = live()?.mcp ?? {}
      const names = Object.keys(statuses)
        .filter((name) => statuses[name]?.status === "connected")
        .sort()
        .join("\n")
      return dir ? { dir, names } : undefined
    },
    undefined,
    { equals: (a, b) => a?.dir === b?.dir && a?.names === b?.names },
  )
  const [toolNames] = createResource(connected, (input) =>
    mcpToolNames(server(), input.dir).catch(() => ({}) as Record<string, string[]>),
  )
  // While editing, the form names the environment values and headers it keeps without showing them.
  const [editSecrets] = createResource(
    () => form.editing || undefined,
    (name) => mcpSecretNames(server(), name).catch(() => ({ environment: [], headers: [] })),
  )
  const rows = createMemo(() => mcpRows(serverSync().data.config.mcp))
  const suggestions = createMemo(() => mcpSuggestions(serverSync().data.config.mcp))
  const formForEntry = (): McpForm =>
    form.kind === "json"
      ? { kind: "json", json: form.json }
      : form.kind === "remote"
        ? { kind: "remote", url: form.url, headers: form.headers, timeout: form.timeout }
        : {
            kind: "local",
            command: form.command,
            // A typed argument not yet added with Enter still counts.
            args: form.arg.trim() ? [...form.args, form.arg] : form.args,
            env: form.env,
            cwd: form.cwd,
            timeout: form.timeout,
          }
  const draft = createMemo(() => mcpEntryFromForm(formForEntry()))
  const nameProblem = createMemo(() =>
    mcpNameProblem(
      form.name,
      rows()
        .map((row) => row.name)
        .filter((name) => name !== form.editing),
    ),
  )
  let list: HTMLDivElement | undefined
  let panel: HTMLFormElement | undefined
  const folderAndTimeout = (entry: ReturnType<typeof rows>[number]["entry"]) => {
    const folder = entry.type === "local" ? entry.cwd : undefined
    const seconds = entry.timeout ? Math.round(entry.timeout / 1000) : undefined
    if (folder && seconds) return language.t("secondBrain.mcp.folderTimeout", { folder, seconds })
    if (folder) return language.t("secondBrain.mcp.folder", { folder })
    if (seconds) return language.t("secondBrain.mcp.timeoutOnly", { seconds })
    return undefined
  }

  const failed = (error: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  const save = (patch: Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0]) =>
    serverSync()
      .updateConfig(patch)
      .then(
        () => true,
        (error: unknown) => {
          failed(error)
          return false
        },
      )

  const resetForm = () =>
    setForm({
      open: false,
      name: "",
      command: "",
      arg: "",
      args: [],
      env: [],
      cwd: "",
      timeout: "",
      url: "",
      headers: [],
      json: "",
      busy: false,
      editing: "",
    })

  const add = () => {
    const entry = draft()
    const name = form.editing || form.name.trim()
    if (!entry || nameProblem() || form.busy) return
    setForm({ busy: true, added: name })
    if (!form.editing) {
      void save({ mcp: { [name]: entry } }).then((saved) => (saved ? resetForm() : setForm("busy", false)))
      return
    }
    // An edit saves only what the form shows; environment values and headers it can't see stay as they are.
    // Saving merges, so a folder or timeout emptied in the form, and a new name, are applied in the file first:
    // if that's refused (the name was taken meanwhile), nothing of the edit is saved.
    const before = rows().find((row) => row.name === name)
    const clear = [
      before?.entry.type === "local" && before.entry.cwd && !form.cwd.trim() ? "cwd" : "",
      before?.entry.timeout && !form.timeout.trim() ? "timeout" : "",
    ].filter(Boolean)
    const next = form.name.trim()
    const rename = next && next !== name ? next : undefined
    const target = rename ?? name
    const reshaped =
      clear.length === 0 && !rename
        ? Promise.resolve(true)
        : editMcpServer(server(), name, { clear, rename }).then(() => {
            void reloadConfig()
            // A retry after a failed save below edits the server under its new name.
            setForm("editing", target)
            return true
          })
    void reshaped
      .then(() => save({ mcp: { [target]: { ...entry, enabled: before?.enabled ?? true } } }))
      .catch((error: unknown) => {
        failed(error)
        return false
      })
      .then((done) => (done ? resetForm() : setForm("busy", false)))
  }

  // The route rewrote the file; the list reads it again now instead of waiting for the next config load.
  const reloadConfig = () => serverSync().reloadConfig()

  // A name a harness can't use as a key is still allowed, but the field says which harnesses won't get it.
  const unreachedBy = (name: string) =>
    name.trim()
      ? mcpReach(name.trim(), { type: "local", command: ["-"], enabled: true }, enabledHarnesses())
          .missing.map((item) => item.harness)
          .join(", ")
      : ""

  const renameProblem = (name: string) =>
    mcpNameProblem(
      rowState.rename,
      rows()
        .map((row) => row.name)
        .filter((item) => item !== name),
    )
  const rename = (name: string) => {
    const next = rowState.rename.trim()
    if (rowState.busy[name]) return
    if (!next || next === name) return setRowState({ renaming: "", rename: "" })
    if (renameProblem(name)) return
    setRowState("busy", name, true)
    void editMcpServer(server(), name, { rename: next })
      .then(() => {
        void reloadConfig()
        setRowState("open", { ...rowState.open, [next]: true, [name]: false })
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("secondBrain.mcp.renamed", { name, next }),
        })
        setRowState({ renaming: "", rename: "" })
      }, failed)
      .finally(() => setRowState("busy", name, false))
  }
  const editServer = (row: ReturnType<typeof rows>[number]) => {
    const entry = row.entry
    const [command = "", ...args] = entry.type === "local" ? entry.command : []
    setForm({
      open: true,
      editing: row.name,
      name: row.name,
      kind: entry.type === "local" ? "local" : "remote",
      command,
      args,
      arg: "",
      env: [],
      headers: [],
      cwd: entry.type === "local" ? (entry.cwd ?? "") : "",
      url: entry.type === "remote" ? entry.url : "",
      timeout: entry.timeout ? String(entry.timeout / 1000) : "",
    })
    // The form opens above the list; bring it to where the user is looking, with the name field ready.
    requestAnimationFrame(() => {
      panel?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" })
      panel?.querySelector("input")?.focus({ preventScroll: true })
    })
  }

  // Sign in starts the server's OAuth flow (the server opens the system browser); Retry connects again.
  const fix = (name: string) => {
    const dir = directory()
    if (!dir || rowState.busy[name]) return
    setRowState("busy", name, true)
    void serverSync()
      .mcp.toggle(dir, name)
      .catch(failed)
      .finally(() => setRowState("busy", name, false))
  }

  const remove = (name: string) => {
    if (rowState.confirming !== name) {
      setRowState("confirming", name)
      // The second click must come soon; otherwise Remove is a plain button again.
      setTimeout(() => rowState.confirming === name && setRowState("confirming", ""), 4000)
      return
    }
    setRowState("busy", name, true)
    void removeMcpServer(server(), name)
      .then(() => {
        void reloadConfig()
        showToast({ variant: "success", icon: "circle-check", title: language.t("secondBrain.mcp.removed", { name }) })
      }, failed)
      .finally(() => setRowState({ confirming: "", busy: { ...rowState.busy, [name]: false } }))
  }

  // The suggested row flies into the installed list: a copy of it moves onto the new row while the list makes room.
  const addSuggestion = async (suggestion: McpSuggestion, item: HTMLElement) => {
    if (form.busy) return
    const from = item.getBoundingClientRect()
    const ghost = item.cloneNode(true)
    if (!(ghost instanceof HTMLElement)) return
    setForm({ busy: true, added: suggestion.id })
    const saved = await save({ mcp: { [suggestion.id]: suggestion.entry } })
    setForm("busy", false)
    if (!saved || reduced()) return
    requestAnimationFrame(() => {
      const row = list?.querySelector<HTMLElement>(`[data-mcp-row="${CSS.escape(suggestion.id)}"]`)
      if (!row) return
      const to = row.getBoundingClientRect()
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        margin: "0",
        zIndex: "100",
        // A row has no surface of its own; the copy borrows the list's.
        background: "var(--v2-background-bg-layer-01)",
        borderRadius: "var(--v2-radius-lg)",
        pointerEvents: "none",
        transformOrigin: "top left",
      })
      document.body.append(ghost)
      void ghost
        .animate(
          [
            { transform: "none", opacity: 1 },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
              opacity: 0,
            },
          ],
          { duration: 420, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
        )
        .finished.finally(() => ghost.remove())
    })
  }

  return (
    <>
      <div class="settings-v2-tab-header flex items-center justify-between gap-3">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.mcp.title")}</h2>
        <ButtonV2 variant="neutral" icon="plus" onClick={() => setForm("open", (open) => !open)}>
          {language.t("secondBrain.mcp.custom")}
        </ButtonV2>
      </div>
      <div class="settings-v2-tab-body flex flex-col gap-5">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("secondBrain.mcp.intro")}</p>
        {/* A panel, not a notice line: it opens over medium and closes over short, like the rest of Settings. */}
        <Reveal open={form.open}>
          <form
            ref={panel}
            class="flex flex-col gap-3 rounded-[24px] bg-v2-background-bg-layer-01 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              add()
            }}
          >
            <div class="settings-v2-fit">
              <SegmentedControlV2
                aria-label={language.t("secondBrain.mcp.kind")}
                value={form.kind}
                onChange={(value) => setForm("kind", value === "remote" || value === "json" ? value : "local")}
              >
                <SegmentedControlItemV2 value="local">{language.t("secondBrain.mcp.local")}</SegmentedControlItemV2>
                <SegmentedControlItemV2 value="remote">{language.t("secondBrain.mcp.remote")}</SegmentedControlItemV2>
                <SegmentedControlItemV2 value="json">{language.t("secondBrain.mcp.json")}</SegmentedControlItemV2>
              </SegmentedControlV2>
            </div>
            <TextInputV2
              type="text"
              class="!w-full"
              value={form.name}
              placeholder={language.t("secondBrain.mcp.namePlaceholder")}
              aria-label={language.t("secondBrain.mcp.name")}
              onInput={(event) => setForm("name", event.currentTarget.value)}
            />
            <Show when={form.name.trim() && nameProblem()}>
              {(problem) => (
                <p class="type-meta text-v2-text-text-muted">{language.t(`secondBrain.mcp.name.${problem()}`)}</p>
              )}
            </Show>
            <Show when={!nameProblem() && unreachedBy(form.name)}>
              {(names) => (
                <p class="type-meta text-v2-text-text-muted">
                  {language.t("secondBrain.mcp.reach.name", { names: names() })}
                </p>
              )}
            </Show>
            <Show when={form.kind === "local"}>
              <TextInputV2
                type="text"
                class="!w-full"
                value={form.command}
                placeholder={language.t("secondBrain.mcp.commandOnlyPlaceholder")}
                aria-label={language.t("secondBrain.mcp.command")}
                onInput={(event) => setForm("command", event.currentTarget.value)}
              />
              {/* Each argument is its own chip, so an argument with a space in it is kept whole. */}
              <div class="flex flex-col gap-2">
                <span class="type-meta text-v2-text-text-muted">{language.t("secondBrain.mcp.args")}</span>
                <Show when={form.args.length > 0}>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={form.args}>
                      {(arg, index) => (
                        <span class="flex items-center gap-1 rounded-full bg-v2-background-bg-layer-02 py-0.5 pl-2.5 pr-1 font-mono text-[12px]">
                          {arg}
                          <IconButtonV2
                            type="button"
                            variant="ghost-muted"
                            size="small"
                            aria-label={language.t("secondBrain.mcp.removeArg", { arg })}
                            icon={<Icon name="close" size="small" />}
                            onClick={() => setForm("args", (args) => args.filter((_, at) => at !== index()))}
                          />
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
                <TextInputV2
                  type="text"
                  class="!w-full"
                  value={form.arg}
                  placeholder={language.t("secondBrain.mcp.argPlaceholder")}
                  aria-label={language.t("secondBrain.mcp.args")}
                  onInput={(event) => setForm("arg", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !form.arg) return
                    event.preventDefault()
                    setForm({ args: [...form.args, form.arg], arg: "" })
                  }}
                />
              </div>
              <PairsField
                label={language.t("secondBrain.mcp.env")}
                add={language.t("secondBrain.mcp.envAdd")}
                keyPlaceholder={language.t("secondBrain.mcp.envKey")}
                valuePlaceholder={language.t("secondBrain.mcp.envValue")}
                pairs={form.env}
                onChange={(env) => setForm("env", env)}
              />
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInputV2
                  type="text"
                  class="!w-full"
                  value={form.cwd}
                  placeholder={language.t("secondBrain.mcp.cwd")}
                  aria-label={language.t("secondBrain.mcp.cwd")}
                  onInput={(event) => setForm("cwd", event.currentTarget.value)}
                />
                <TextInputV2
                  type="text"
                  inputMode="numeric"
                  class="!w-full"
                  value={form.timeout}
                  placeholder={language.t("secondBrain.mcp.timeout")}
                  aria-label={language.t("secondBrain.mcp.timeout")}
                  onInput={(event) => setForm("timeout", event.currentTarget.value)}
                />
              </div>
            </Show>
            <Show when={form.kind === "remote"}>
              <TextInputV2
                type="text"
                class="!w-full"
                value={form.url}
                placeholder={language.t("secondBrain.mcp.urlPlaceholder")}
                aria-label={language.t("secondBrain.mcp.url")}
                onInput={(event) => setForm("url", event.currentTarget.value)}
              />
              <PairsField
                label={language.t("secondBrain.mcp.headers")}
                add={language.t("secondBrain.mcp.headersAdd")}
                keyPlaceholder={language.t("secondBrain.mcp.headerKey")}
                valuePlaceholder={language.t("secondBrain.mcp.envValue")}
                pairs={form.headers}
                onChange={(headers) => setForm("headers", headers)}
              />
              <TextInputV2
                type="text"
                inputMode="numeric"
                class="!w-full"
                value={form.timeout}
                placeholder={language.t("secondBrain.mcp.timeout")}
                aria-label={language.t("secondBrain.mcp.timeout")}
                onInput={(event) => setForm("timeout", event.currentTarget.value)}
              />
            </Show>
            <Show when={form.editing}>
              <p class="type-meta text-v2-text-text-muted">
                {[
                  (() => {
                    const names = [...(editSecrets.latest?.environment ?? []), ...(editSecrets.latest?.headers ?? [])]
                    return names.length > 0 ? language.t("secondBrain.mcp.editKeeps", { names: names.join(", ") }) : ""
                  })(),
                  language.t("secondBrain.mcp.editClears"),
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
            </Show>
            <Show when={form.kind === "json"}>
              <textarea
                class="min-h-28 w-full rounded-[12px] bg-v2-background-bg-base px-3 py-2 font-mono text-[12px] text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
                value={form.json}
                placeholder={language.t("secondBrain.mcp.jsonPlaceholder")}
                aria-label={language.t("secondBrain.mcp.json")}
                onInput={(event) => setForm("json", event.currentTarget.value)}
              />
            </Show>
            <div class="flex justify-end gap-2">
              <ButtonV2 type="button" variant="ghost" onClick={resetForm}>
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2 type="submit" variant="contrast" disabled={form.busy || !!nameProblem() || !draft()}>
                {language.t("common.save")}
              </ButtonV2>
            </div>
          </form>
        </Reveal>

        <section class="settings-v2-section" aria-labelledby="mcp-installed-title">
          <h3 id="mcp-installed-title" class="settings-v2-section-title">
            {language.t("secondBrain.mcp.installed")}
          </h3>
          <Show
            when={rows().length > 0}
            fallback={
              <SettingsListV2>
                <div class="settings-v2-provider-empty">{language.t("secondBrain.mcp.empty")}</div>
              </SettingsListV2>
            }
          >
            <div ref={list}>
              <SettingsListV2>
                <For each={rows()}>
                  {(row) => {
                    const state = () => mcpRowState(row.enabled ? live()?.mcp?.[row.name] : { status: "disabled" })
                    const reach = () => mcpReach(row.name, row.entry, enabledHarnesses())
                    const opened = () => rowState.open[row.name] === true
                    const busy = () => rowState.busy[row.name] === true
                    const [secrets] = createResource(
                      () => (opened() ? row.name : undefined),
                      (name) => mcpSecretNames(server(), name).catch(() => ({ environment: [], headers: [] })),
                    )
                    const secretNames = () => [
                      ...(secrets.latest?.environment ?? []),
                      ...(secrets.latest?.headers ?? []),
                    ]
                    const tools = () => toolNames.latest?.[row.name] ?? []
                    return (
                      <div data-mcp-row={row.name} classList={{ "animate-enter": row.name === form.added }}>
                        <div data-component="settings-v2-row">
                          <span
                            class={`size-2 shrink-0 rounded-full ${statusDotClass(row.enabled ? live()?.mcp?.[row.name]?.status : "disabled")}`}
                            aria-hidden="true"
                          />
                          <div data-slot="settings-v2-row-copy">
                            <span data-slot="settings-v2-row-title" class="truncate">
                              {row.name}
                            </span>
                            <span data-slot="settings-v2-row-description" class="break-words">
                              {stateLine(language, state(), toolNames.latest?.[row.name]?.length) ?? row.detail}
                            </span>
                            <span data-slot="settings-v2-row-description">{reachLine(language, reach())}</span>
                          </div>
                          <Show when={state().kind === "needs_auth" || state().kind === "failed"}>
                            <ButtonV2
                              size="normal"
                              variant={state().kind === "needs_auth" ? "contrast" : "neutral"}
                              disabled={busy()}
                              onClick={() => fix(row.name)}
                            >
                              {language.t(
                                state().kind === "needs_auth" ? "secondBrain.mcp.signIn" : "secondBrain.mcp.retry",
                              )}
                            </ButtonV2>
                          </Show>
                          <IconButtonV2
                            type="button"
                            variant="ghost-muted"
                            size="normal"
                            aria-expanded={opened()}
                            aria-label={language.t("secondBrain.mcp.details", { name: row.name })}
                            icon={
                              <Icon
                                name="chevron-down"
                                class="transition-transform duration-short ease-standard motion-reduce:transition-none"
                                classList={{ "rotate-180": opened() }}
                              />
                            }
                            onClick={() => setRowState("open", row.name, !opened())}
                          />
                          <ToggleSwitch
                            checked={row.enabled}
                            hideLabel
                            onChange={(enabled) => void save({ mcp: { [row.name]: { ...row.entry, enabled } } })}
                          >
                            {language.t("secondBrain.mcp.enabled", { name: row.name })}
                          </ToggleSwitch>
                        </div>
                        <Reveal open={opened()}>
                          <div class="flex flex-col gap-2 px-4 pb-4">
                            <div class="flex flex-wrap gap-1.5">
                              <For each={row.entry.type === "local" ? row.entry.command : [row.entry.url]}>
                                {(part) => (
                                  <span class="rounded-full bg-v2-background-bg-layer-02 px-2.5 py-0.5 font-mono text-[12px] break-all">
                                    {part}
                                  </span>
                                )}
                              </For>
                            </div>
                            {/* The whole error; the row's line shows only its first line. */}
                            <Show
                              when={(() => {
                                const current = state()
                                return current.kind === "failed" ? current.error : undefined
                              })()}
                            >
                              {(error) => <p class="type-meta break-words text-v2-text-text-muted">{error()}</p>}
                            </Show>
                            <Show when={folderAndTimeout(row.entry)}>
                              {(line) => <p class="type-meta text-v2-text-text-muted">{line()}</p>}
                            </Show>
                            {/* Names only: the values stay in the config file. */}
                            <Show when={secretNames().length > 0}>
                              <div class="flex flex-wrap gap-1.5">
                                <For each={secretNames()}>
                                  {(name) => (
                                    <span class="rounded-full bg-v2-background-bg-layer-02 px-2.5 py-0.5 font-mono text-[12px] break-all">
                                      {language.t("secondBrain.mcp.secretValue", { name })}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                            <p class="type-meta text-v2-text-text-muted">
                              {language.t("secondBrain.mcp.secretsHidden")}
                            </p>
                            <Show when={rowState.renaming === row.name}>
                              <form
                                class="flex flex-wrap items-center gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  rename(row.name)
                                }}
                              >
                                <TextInputV2
                                  type="text"
                                  class="!w-64"
                                  value={rowState.rename}
                                  aria-label={language.t("secondBrain.mcp.name")}
                                  onInput={(event) => setRowState("rename", event.currentTarget.value)}
                                />
                                <ButtonV2
                                  type="button"
                                  size="normal"
                                  variant="ghost"
                                  onClick={() => setRowState({ renaming: "", rename: "" })}
                                >
                                  {language.t("common.cancel")}
                                </ButtonV2>
                                <ButtonV2
                                  type="submit"
                                  size="normal"
                                  variant="contrast"
                                  disabled={busy() || !!renameProblem(row.name)}
                                >
                                  {language.t("common.save")}
                                </ButtonV2>
                                <Show when={rowState.rename.trim() !== row.name && renameProblem(row.name)}>
                                  {(problem) => (
                                    <p class="w-full type-meta text-v2-text-text-muted">
                                      {language.t(`secondBrain.mcp.name.${problem()}`)}
                                    </p>
                                  )}
                                </Show>
                                <Show when={!renameProblem(row.name) && unreachedBy(rowState.rename)}>
                                  {(names) => (
                                    <p class="w-full type-meta text-v2-text-text-muted">
                                      {language.t("secondBrain.mcp.reach.name", { names: names() })}
                                    </p>
                                  )}
                                </Show>
                              </form>
                            </Show>
                            <div class="flex items-center justify-end gap-2">
                              {/* A server lists its tools only once connected; until then the line says so. */}
                              <span class="min-w-0 flex-1 truncate type-meta text-v2-text-text-muted">
                                {tools().length > 0
                                  ? language.t("secondBrain.mcp.tools", { names: tools().join(", ") })
                                  : state().kind === "connected"
                                    ? ""
                                    : language.t("secondBrain.mcp.toolsLater")}
                              </span>
                              <ButtonV2 size="normal" variant="ghost" onClick={() => editServer(row)}>
                                {language.t("secondBrain.mcp.edit")}
                              </ButtonV2>
                              <ButtonV2
                                size="normal"
                                variant="ghost"
                                disabled={busy()}
                                onClick={() => setRowState({ renaming: row.name, rename: row.name })}
                              >
                                {language.t("secondBrain.mcp.rename")}
                              </ButtonV2>
                              <ButtonV2
                                size="normal"
                                variant={rowState.confirming === row.name ? "danger" : "neutral"}
                                disabled={busy()}
                                onClick={() => remove(row.name)}
                              >
                                {language.t(
                                  rowState.confirming === row.name
                                    ? "secondBrain.mcp.removeConfirm"
                                    : "secondBrain.mcp.remove",
                                )}
                              </ButtonV2>
                            </div>
                          </div>
                        </Reveal>
                      </div>
                    )
                  }}
                </For>
              </SettingsListV2>
            </div>
          </Show>
        </section>

        <Show when={suggestions().length > 0}>
          <section class="settings-v2-section" aria-labelledby="mcp-suggested-title">
            <h3 id="mcp-suggested-title" class="settings-v2-section-title">
              {language.t("secondBrain.mcp.suggested")}
            </h3>
            <SettingsListV2>
              <For each={suggestions()}>
                {(suggestion) => {
                  let item: HTMLDivElement | undefined
                  return (
                    <div ref={item}>
                      <SettingsRowV2
                        title={language.t(`secondBrain.mcp.suggest.${suggestion.id}.title`)}
                        description={
                          suggestion.signIn
                            ? language.t("secondBrain.mcp.withSignIn", {
                                body: language.t(`secondBrain.mcp.suggest.${suggestion.id}.body`),
                              })
                            : language.t(`secondBrain.mcp.suggest.${suggestion.id}.body`)
                        }
                      >
                        <ButtonV2
                          variant="neutral"
                          icon="plus"
                          disabled={form.busy}
                          onClick={() => item && void addSuggestion(suggestion, item)}
                        >
                          {language.t("secondBrain.mcp.addOne")}
                        </ButtonV2>
                      </SettingsRowV2>
                    </div>
                  )
                }}
              </For>
            </SettingsListV2>
          </section>
        </Show>
      </div>
    </>
  )
}

type Language = ReturnType<typeof useLanguage>

/** The row's status line, or undefined to show what the server runs. */
function stateLine(language: Language, state: ReturnType<typeof mcpRowState>, tools?: number) {
  if (state.kind === "connected")
    return tools === undefined
      ? language.t("secondBrain.mcp.state.connected")
      : language.plural("secondBrain.mcp.state.connectedTools", tools, { count: tools })
  if (state.kind === "needs_auth") return language.t("secondBrain.mcp.state.needsAuth")
  if (state.kind === "pending") return language.t("secondBrain.mcp.state.pending")
  if (state.kind === "failed")
    return state.error
      ? language.t("secondBrain.mcp.state.failed", { error: state.error.split("\n")[0] ?? "" })
      : language.t("secondBrain.mcp.state.failedPlain")
  return undefined
}

/** Which harnesses receive the server, and why the rest don't. */
function reachLine(language: Language, reach: ReturnType<typeof mcpReach>) {
  if (reach.receives.length === 0 && reach.maybe.length === 0 && reach.missing.length === 0)
    return language.t("secondBrain.mcp.reach.none")
  return [
    reach.receives.length > 0 ? language.t("secondBrain.mcp.reach.receives", { names: reach.receives.join(", ") }) : "",
    reach.maybe.length > 0 ? language.t("secondBrain.mcp.reach.maybe", { names: reach.maybe.join(", ") }) : "",
    reach.missing.length > 0
      ? language.t("secondBrain.mcp.reach.name", { names: reach.missing.map((item) => item.harness).join(", ") })
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Key and value rows (environment variables, headers), added one at a time. */
function PairsField(props: {
  label: string
  add: string
  keyPlaceholder: string
  valuePlaceholder: string
  pairs: Pair[]
  onChange: (pairs: Pair[]) => void
}) {
  const set = (index: number, field: keyof Pair, value: string) =>
    props.onChange(props.pairs.map((pair, at) => (at === index ? { ...pair, [field]: value } : pair)))
  return (
    <div class="flex flex-col gap-2">
      <span class="type-meta text-v2-text-text-muted">{props.label}</span>
      <For each={props.pairs}>
        {(pair, index) => (
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TextInputV2
              type="text"
              class="!w-full font-mono"
              value={pair.key}
              placeholder={props.keyPlaceholder}
              aria-label={props.keyPlaceholder}
              onInput={(event) => set(index(), "key", event.currentTarget.value)}
            />
            <TextInputV2
              type="password"
              class="!w-full font-mono"
              value={pair.value}
              placeholder={props.valuePlaceholder}
              aria-label={props.valuePlaceholder}
              onInput={(event) => set(index(), "value", event.currentTarget.value)}
            />
          </div>
        )}
      </For>
      <div>
        <ButtonV2
          type="button"
          size="normal"
          variant="ghost"
          icon="plus"
          onClick={() => props.onChange([...props.pairs, { key: "", value: "" }])}
        >
          {props.add}
        </ButtonV2>
      </div>
    </div>
  )
}
