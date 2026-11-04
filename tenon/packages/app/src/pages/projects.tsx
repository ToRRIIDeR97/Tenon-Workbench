import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useCommand } from "@/context/command"
import { useDrafts } from "@/context/drafts"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import {
  listVaultConflicts,
  listVaultPages,
  readProjectLog,
  readTimeline,
  removeVaultPage,
  SecondBrainRequestError,
  writeTimeline,
  writeVaultPage,
  type ProjectRecord,
  type TimelineItem,
  type VaultPageInfo,
} from "@/features/second-brain/client"
import { NotesPageView } from "@/features/second-brain/notes-page"
import { matchProjects, newPagePath } from "@/features/second-brain/notes-timeline"
import { ProjectCreate, ProjectDetails, projectWorkPrompt } from "@/features/second-brain/project-details"
import { ProjectView, sectionFromTab } from "@/features/second-brain/project-view"
import { PageEmpty, pagePanelClass, pageRowClass } from "@/components/page"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { useVaultPages, vaultMigration } from "@/features/second-brain/vault-pages"
import { settled } from "@/utils/resource"
import { sessionHref } from "@/utils/session-route"
import { dismissToast, showToast } from "@/utils/toast"
import { createUndoQueue } from "@/utils/undo-action"

/**
 * Projects: every Project and page in the Tenon vault. URL contract: `/projects` (the landing: Projects, Archived,
 * General pages), `/projects?project=<id>&section=<tasks|pages|threads|log|settings>` (a Project as one page; an
 * older `&tab=` maps to its section), `/projects?page=<path>` and `/projects?new=1` (the New Project form).
 * `/notes` links redirect here. A page opened from a Project keeps that Project's URL in history, so Back returns to
 * it.
 */
export default function ProjectsPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation<{ fromNotes?: boolean }>()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const drafts = useDrafts()
  const command = useCommand()
  const brainProjects = useBrainProjects()
  // `note` is the pre-vault link form (wiki links in page previews still use it).
  const [search] = useSearchParams<{
    project?: string
    tab?: string
    section?: string
    page?: string
    note?: string
    new?: string
  }>()
  const [state, setState] = createStore({
    directory: "",
    /** The open page has unsaved edits. */
    dirty: false,
    creating: false,
    error: "",
    /** Notes the first visit moved into the vault; 0 hides the notice. */
    moved: 0,
    search: "",
    /** The debounced search the server runs. */
    query: "",
    archivedOpen: false,
    /** Pages whose delete waits for its Undo window to close, by `pageKey`. */
    deleting: {} as Record<string, boolean>,
  })
  const directory = () => state.directory
  const client = (target: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory: target },
  })

  // Follow the sidebar workspace, but an open page with unsaved edits holds its workspace until they are
  // saved or discarded; the page says why meanwhile.
  const sidebarDirectory = () => layout.home.workspace() ?? ""
  const held = () => state.dirty && sidebarDirectory() !== state.directory
  createEffect(() => {
    const next = sidebarDirectory()
    if (next === state.directory || state.dirty) return
    setState({ directory: next, error: "", moved: 0, search: "", query: "" })
  })

  // The first read of a workspace's vault moves its pre-vault notes in.
  const vault = useVaultPages(() => directory() || undefined)
  // Taken once, or a revisit within the cache's life would show the notice again.
  createEffect(() => {
    const moved = vault.moved()
    if (moved <= 0) return
    setState("moved", moved)
    vault.clearMoved()
  })
  // Waits for the move above, which the server would otherwise make (and report) on this first vault read.
  const [conflicts] = createResource(
    () => directory() || undefined,
    async (target) => {
      await vaultMigration(target)
      return listVaultConflicts(client(target)).catch(() => [])
    },
  )
  const scheduleQuery = debounce((value: string) => setState("query", value), 250)
  createEffect(
    on(
      () => state.search.trim(),
      (value) => {
        if (value) return scheduleQuery(value)
        scheduleQuery.clear()
        setState("query", "")
      },
    ),
  )
  const [matches] = createResource(
    () => (directory() && state.query ? ([directory(), state.query] as const) : undefined),
    ([target, query]) => listVaultPages(client(target), { search: query }),
  )
  const pageKey = (target: string, path: string) => `${target}
${path}`
  const visible = (page: VaultPageInfo) => !state.deleting[pageKey(directory(), page.path)]
  const pageList = () => (vault.pages() ?? []).filter(visible)
  const foundPages = () => (settled(matches) ?? []).filter(visible)
  const foundProjects = () => matchProjects(projects(), state.query)
  const projects = () => (held() ? [] : (brainProjects.list() ?? []))
  const known = createMemo(() => new Set(projects().map((item) => item.id)))
  // Pages tied to no Project this workspace lists.
  const generalPages = () => pageList().filter((page) => !page.projectId || !known().has(page.projectId))
  // The vault refuses to live inside a workspace or Project folder; say so instead of a generic failure.
  const misplaced = () => {
    const error = vault.error()
    return error instanceof SecondBrainRequestError && error.reason === "vault_inside_workspace"
  }

  const pagePath = () => search.page ?? search.note ?? ""
  const projectId = () => (pagePath() ? "" : (search.project ?? ""))
  const section = () => sectionFromTab(search.section ?? search.tab)
  const project = createMemo(() => projects().find((item) => item.id === projectId()))

  const projectKey = () => (directory() && projectId() ? ([directory(), projectId()] as const) : undefined)
  const [timeline, timelineActions] = createResource(projectKey, ([target, id]) => readTimeline(client(target), id))
  const [log, logActions] = createResource(projectKey, ([target, id]) => readProjectLog(client(target), id))

  // Saves the Project's items over the revision on screen; a stale save reloads the timeline instead.
  const saveItems = async (items: ReadonlyArray<TimelineItem>) => {
    const key = projectKey()
    const current = settled(timeline)
    if (!key || !current) return language.t("secondBrain.error.request")
    const result = await writeTimeline(client(key[0]), key[1], { items, expectedRevision: current.revision }).then(
      (saved) => ({ saved, error: undefined }),
      (error: unknown) => ({ saved: undefined, error }),
    )
    if (result.saved) {
      if (projectKey()?.[1] === key[1] && projectKey()?.[0] === key[0]) timelineActions.mutate(result.saved)
      return ""
    }
    const stale = result.error instanceof SecondBrainRequestError && result.error.status === 409
    if (stale) void timelineActions.refetch()
    return language.t(stale ? "secondBrain.vault.timeline.stale" : "secondBrain.error.request")
  }

  const pageHref = (path: string) => `/projects?page=${encodeURIComponent(path)}`
  const openPage = (path: string) => navigate(pageHref(path), { state: { fromNotes: true } })
  const openProject = (id: string) => navigate(`/projects?project=${encodeURIComponent(id)}`)
  // The open page's Project, else the landing.
  const parentHref = () => {
    const owner = pageList().find((page) => page.path === pagePath())?.projectId
    return owner ? `/projects?project=${encodeURIComponent(owner)}&section=pages` : "/projects"
  }
  const back = () => (location.state?.fromNotes ? navigate(-1) : navigate(parentHref()))
  // Folder Projects run their threads in the folder the server resolves; a legacy card in its linked workspace.
  const threadDirectory = (record: ProjectRecord) =>
    brainProjects.entries()?.find((entry) => entry.project.id === record.id)?.threadDirectory ??
    layout.projects.list().find((location) => location.id === record.location?.workspaceId)?.worktree

  // The open Project's recent root threads, from the same per-folder lists the sidebar reads.
  const projectFolder = () => {
    const record = project()
    return record ? threadDirectory(record) : undefined
  }
  createEffect(() => {
    const folder = projectFolder()
    if (folder) void serverSync().project.loadSessions(folder)
  })
  const threads = createMemo(() => {
    const folder = projectFolder()
    if (!folder) return []
    return serverSync()
      .child(folder, { bootstrap: false })[0]
      .session.filter((session) => !session.parentID && !session.time.archived)
      .sort((left, right) => right.time.updated - left.time.updated)
      .slice(0, 6)
      .map((session) => ({
        id: session.id,
        title: session.title || language.t("secondBrain.project.untitledThread"),
        updated: session.time.updated,
        running: serverSync().session.data.session_working(session.id),
      }))
  })

  // A new page goes into `owner` (a Project), else the workspace's General pages; it opens right away.
  const createPage = async (owner?: string) => {
    const target = directory()
    if (!target || state.creating) return
    const folder = owner
      ? pageList()
          .find((page) => page.projectId === owner)
          ?.path.split("/")[0]
      : ""
    const title = language.t("secondBrain.vault.untitled")
    setState({ creating: true, error: "" })
    const result = await writeVaultPage(client(target), {
      path: newPagePath(title, folder ?? "", pageList()),
      title,
      body: "",
      projectId: owner,
      create: true,
    }).then(
      (page) => ({ page, error: undefined }),
      (error: unknown) => ({ page: undefined, error }),
    )
    setState("creating", false)
    if (!result.page) {
      const exists = result.error instanceof SecondBrainRequestError && result.error.status === 409
      return setState("error", language.t(exists ? "secondBrain.vault.exists" : "secondBrain.error.request"))
    }
    if (target !== directory()) return
    vault.store(result.page.info)
    openPage(result.page.info.path)
  }

  const undo = createUndoQueue({
    show: (action, run) =>
      showToast({
        title: action.title,
        description: action.description,
        persistent: true,
        actions: [{ label: language.t("secondBrain.sidebar.undo"), onClick: run }],
      }),
    dismiss: dismissToast,
    onError: (cause) =>
      showToast({
        variant: "error",
        title: language.t(
          cause instanceof SecondBrainRequestError && cause.status === 409
            ? "secondBrain.vault.deleteStale"
            : "secondBrain.error.request",
        ),
      }),
  })
  onCleanup(() => undo.flush())

  /**
   * Delete is deferred like a thread's: the page leaves the lists now and the file goes when the Undo window closes.
   * If the app quits first, the page is simply not deleted. The removed version stays in the page's history.
   */
  const deletePage = (page: { path: string; title: string; revision: string }) => {
    const target = directory()
    const targetClient = client(target)
    const key = pageKey(target, page.path)
    // Not back(): a page opened from outside Projects would leave this page, which commits the delete with no Undo.
    navigate(parentHref(), { replace: true })
    setState("deleting", key, true)
    const restore = () => setState("deleting", key, false)
    const removed = () => {
      if (target === directory()) vault.remove(page.path)
      restore()
    }
    undo.push({
      title: language.t("secondBrain.vault.deleted"),
      description: page.title,
      undo: restore,
      commit: () =>
        removeVaultPage(targetClient, page.path, page.revision)
          .then(removed)
          .catch((cause: unknown) => {
            // Already gone, e.g. deleted from another window: treat it as done.
            if (cause instanceof SecondBrainRequestError && cause.status === 404) return removed()
            restore()
            throw cause
          }),
    })
  }

  const conflictName = (path: string) => path.split("/").pop() ?? path

  const conflictBanner = () => (
    <>
      <RevealShow when={state.moved > 0 && state.moved} class="shrink-0">
        {(moved) => (
          <div
            role="status"
            class="mx-4 mt-3 flex items-center gap-2 rounded-[16px] bg-v2-background-bg-layer-01 py-1.5 pl-4 pr-1.5 text-[13px] text-v2-text-text-base sm:mx-6"
          >
            <span class="min-w-0 flex-1">
              {language.plural("secondBrain.vault.moved", moved(), {
                count: moved().toLocaleString(language.intl()),
              })}
            </span>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              class="!size-8"
              aria-label={language.t("common.dismiss")}
              icon={<Icon name="xmark-small" size="small" />}
              onClick={() => setState("moved", 0)}
            />
          </div>
        )}
      </RevealShow>
      {conflictCopies()}
    </>
  )

  // Only Markdown copies open as pages; others (a sync copy of `project.json`, an image) are named only.
  const conflictCopies = () => (
    <RevealShow when={(settled(conflicts) ?? []).length > 0 && settled(conflicts)} class="shrink-0">
      {(list) => (
        <div
          role="status"
          class="mx-4 mt-3 flex flex-col gap-1.5 rounded-[16px] bg-v2-background-bg-layer-01 px-4 py-3 text-[13px] sm:mx-6"
        >
          <p class="flex items-center gap-2 text-v2-text-text-base [font-weight:500]">
            <Icon name="warning" size="small" class="text-v2-icon-icon-muted" />
            {language.t("secondBrain.vault.conflicts.title")}
          </p>
          <p class="text-[12px] text-v2-text-text-muted">{language.t("secondBrain.vault.conflicts.body")}</p>
          <ul class="flex flex-wrap gap-1.5">
            <For each={list()}>
              {(conflict) => (
                <li>
                  <Show
                    when={conflict.path.toLowerCase().endsWith(".md")}
                    fallback={
                      <span
                        title={conflict.path}
                        class="block max-w-80 truncate rounded-full px-2.5 py-1 text-[12px] text-v2-text-text-muted"
                      >
                        {conflictName(conflict.path)}
                      </span>
                    }
                  >
                    <button
                      type="button"
                      title={conflict.path}
                      class="max-w-80 truncate rounded-full bg-v2-background-bg-layer-02 px-2.5 py-1 text-[12px] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-03 motion-reduce:transition-none"
                      onClick={() => openPage(conflict.path)}
                    >
                      {conflictName(conflict.path)}
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      )}
    </RevealShow>
  )

  const projectRow = (record: ProjectRecord) => (
    <li>
      <button type="button" class={pageRowClass} data-project-row={record.id} onClick={() => openProject(record.id)}>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[14px] text-v2-text-text-base [font-weight:500]">{record.name}</span>
          <span class="block truncate text-[12px] text-v2-text-text-faint">{record.outcome}</span>
        </span>
        <Show when={record.status === "paused"}>
          <span class="shrink-0 text-[12px] text-v2-text-text-muted">
            {language.t("secondBrain.projects.filter.paused")}
          </span>
        </Show>
        <span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-v2-background-bg-layer-03" aria-hidden="true">
          <span
            class="block h-full rounded-full bg-v2-background-bg-accent"
            style={{ width: `${record.progressPercent}%` }}
          />
        </span>
        <span class="w-9 shrink-0 text-right text-[12px] tabular-nums text-v2-text-text-faint">
          {record.progressPercent}%
        </span>
      </button>
    </li>
  )
  const pageRow = (page: VaultPageInfo) => (
    <li>
      <button type="button" class={`${pageRowClass} text-[13px]`} onClick={() => openPage(page.path)}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          class="shrink-0 text-v2-icon-icon-muted"
        >
          <path d="M4 1.5h5.5L12.5 4.5v10H4z" stroke="currentColor" />
        </svg>
        <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{page.title}</span>
        <Show when={page.projectId && known().has(page.projectId) ? page.projectId : undefined}>
          {(id) => (
            <span class="shrink-0 truncate text-[12px] text-v2-text-text-faint">
              {projects().find((item) => item.id === id())?.name}
            </span>
          )}
        </Show>
      </button>
    </li>
  )
  const sectionTitle = (id: string, text: string) => (
    <h2 id={id} class="px-3 text-[12px] text-v2-text-text-muted [font-weight:500]">
      {text}
    </h2>
  )

  const landing = () => {
    const active = () => projects().filter((record) => record.status !== "archived")
    const archived = () => projects().filter((record) => record.status === "archived")
    return (
      <div class="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 pb-10 pt-8 sm:px-10">
        <header class="flex flex-wrap items-center gap-2">
          <h1
            id="projects-title"
            class="min-w-0 flex-1 text-[28px] leading-[38px] text-v2-text-text-base [font-weight:700]"
          >
            {language.t("secondBrain.projects.title")}
          </h1>
          <ButtonV2 variant="ghost" icon="plus" disabled={state.creating} onClick={() => void createPage()}>
            {language.t("secondBrain.vault.newPage")}
          </ButtonV2>
          <ButtonV2
            variant="contrast"
            icon="plus"
            data-action="new-project"
            onClick={() => navigate("/projects?new=1")}
          >
            {language.t("secondBrain.projects.new")}
          </ButtonV2>
        </header>
        <RevealShow when={state.error}>
          {(error) => (
            <p role="alert" class="px-1 text-[12px] text-v2-text-text-critical">
              {error()}
            </p>
          )}
        </RevealShow>
        <label class="relative block">
          <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-v2-icon-icon-muted">
            <Icon name="magnifying-glass" size="small" />
          </span>
          <input
            class="h-9 w-full rounded-full bg-v2-background-bg-layer-01 pl-9 pr-3 text-[13px] text-v2-text-text-base transition-[background-color,box-shadow] duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none"
            aria-label={language.t("secondBrain.vault.search")}
            placeholder={language.t("secondBrain.vault.search")}
            value={state.search}
            onInput={(event) => setState("search", event.currentTarget.value)}
          />
        </label>
        <Show
          when={!state.search.trim()}
          fallback={
            <Show
              when={!matches.loading && state.query}
              fallback={<p class="px-3 text-[12px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
            >
              <Show
                when={foundProjects().length + foundPages().length > 0}
                fallback={
                  <PageEmpty error={!!matches.error}>
                    {language.t(matches.error ? "common.requestFailed" : "secondBrain.vault.noMatches")}
                  </PageEmpty>
                }
              >
                <ul class="flex flex-col gap-px" aria-label={language.t("secondBrain.vault.results")}>
                  <For each={foundProjects()}>{(record) => projectRow(record)}</For>
                  <For each={foundPages()}>{(page) => pageRow(page)}</For>
                </ul>
              </Show>
            </Show>
          }
        >
          <section aria-labelledby="projects-list-title" class="flex flex-col gap-1">
            {sectionTitle("projects-list-title", language.t("secondBrain.vault.projects"))}
            <ul class="flex flex-col gap-px">
              {/* Every Project's next milestone, upcoming items and recent pages, across the workspace. */}
              <li>
                <button type="button" class={pageRowClass} onClick={() => navigate("/projects/overview")}>
                  <span
                    aria-hidden="true"
                    class="flex size-8 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 text-v2-icon-icon-muted"
                  >
                    <Icon name="workspace" size="small" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px] text-v2-text-text-base [font-weight:500]">
                      {language.t("secondBrain.projects.overview.title")}
                    </span>
                    <span class="block truncate text-[12px] text-v2-text-text-faint">
                      {language.t("secondBrain.projects.overview.description")}
                    </span>
                  </span>
                </button>
              </li>
              <For each={active()}>{(record) => projectRow(record)}</For>
            </ul>
            <Show when={!brainProjects.loading() && active().length === 0}>
              <p class="px-3 py-2 text-[13px] text-v2-text-text-faint">
                {language.t("secondBrain.projects.emptyActive")}
              </p>
            </Show>
            <Show when={archived().length > 0}>
              <button
                type="button"
                aria-expanded={state.archivedOpen}
                class="mt-1 flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
                onClick={() => setState("archivedOpen", (open) => !open)}
              >
                <Icon
                  name="chevron-down"
                  size="small"
                  classList={{
                    "transition-transform duration-short motion-reduce:transition-none": true,
                    "-rotate-90": !state.archivedOpen,
                  }}
                />
                {language.t("secondBrain.projects.filter.archived")} · {archived().length}
              </button>
              <Show when={state.archivedOpen}>
                <ul class="flex flex-col gap-px" aria-label={language.t("secondBrain.projects.filter.archived")}>
                  <For each={archived()}>{(record) => projectRow(record)}</For>
                </ul>
              </Show>
            </Show>
          </section>
          <section aria-labelledby="projects-general-title" class="flex flex-col gap-1">
            {sectionTitle("projects-general-title", language.t("secondBrain.vault.general"))}
            <Show
              when={!vault.error()}
              fallback={
                <PageEmpty
                  error
                  title={language.t("secondBrain.state.error.title")}
                  action={
                    <ButtonV2 size="small" variant="outline" onClick={vault.retry}>
                      {language.t("secondBrain.state.retry")}
                    </ButtonV2>
                  }
                >
                  {language.t("secondBrain.state.error.body")}
                </PageEmpty>
              }
            >
              <Show
                when={generalPages().length > 0}
                fallback={
                  <p class="px-3 py-2 text-[13px] text-v2-text-text-faint">
                    {vault.loading() ? language.t("common.loading") : language.t("secondBrain.project.generalEmpty")}
                  </p>
                }
              >
                <ul class="flex flex-col gap-px">
                  <For each={generalPages()}>{(page) => pageRow(page)}</For>
                </ul>
              </Show>
            </Show>
          </section>
        </Show>
      </div>
    )
  }

  return (
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-label={language.t("secondBrain.projects.title")}>
      <div class={`flex min-h-0 flex-1 flex-col overflow-hidden ${pagePanelClass}`}>
        <Show
          when={directory()}
          fallback={
            <PageEmpty
              title={language.t("secondBrain.state.noWorkspace.title")}
              action={
                <ButtonV2 variant="contrast" onClick={() => command.trigger("project.open")}>
                  {language.t("secondBrain.home.openWorkspace")}
                </ButtonV2>
              }
            >
              {language.t("secondBrain.state.noWorkspace.body")}
            </PageEmpty>
          }
        >
          <Show
            when={!misplaced()}
            fallback={
              <PageEmpty error title={language.t("secondBrain.vault.misplaced.title")}>
                {language.t("secondBrain.vault.misplaced.body")}
              </PageEmpty>
            }
          >
            <Show
              when={pagePath() ? { path: pagePath(), directory: directory() } : undefined}
              keyed
              fallback={
                <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                  {conflictBanner()}
                  <Show
                    when={search.new !== "1"}
                    fallback={
                      <ProjectCreate
                        directory={directory()}
                        onCreated={(created) => openProject(created.id)}
                        onCancel={() => navigate("/projects")}
                      />
                    }
                  >
                    <Show when={projectId()} fallback={landing()}>
                      <Show
                        when={project()}
                        fallback={
                          <PageEmpty
                            loading={brainProjects.loading()}
                            title={
                              brainProjects.loading()
                                ? language.t("common.loading")
                                : language.t("secondBrain.vault.projectMissing")
                            }
                            action={
                              brainProjects.loading() ? undefined : (
                                <ButtonV2 size="small" variant="outline" onClick={() => navigate("/projects")}>
                                  {language.t("secondBrain.projects.back")}
                                </ButtonV2>
                              )
                            }
                          />
                        }
                      >
                        {(item) => {
                          const folder = () => threadDirectory(item())
                          const startDraft = (prompt?: string) => {
                            const target = folder()
                            if (!target) return
                            void drafts.create({ server: server.key, directory: target, projectID: item().id }, prompt)
                          }
                          return (
                            <ProjectView
                              project={item()}
                              section={section()}
                              timeline={{
                                value: settled(timeline),
                                loading: timeline.loading,
                                failed: !!timeline.error,
                                retry: () => void timelineActions.refetch(),
                              }}
                              log={{
                                value: settled(log),
                                loading: log.loading,
                                failed: !!log.error,
                                retry: () => void logActions.refetch(),
                              }}
                              pages={pageList().filter((page) => page.projectId === item().id)}
                              pageHref={pageHref}
                              onPage={openPage}
                              onNewPage={() => void createPage(item().id)}
                              creatingPage={state.creating}
                              pageError={state.error}
                              onSaveItems={saveItems}
                              threads={threads()}
                              threadHref={(id) => sessionHref(server.key, id)}
                              onNewThread={folder() ? () => startDraft() : undefined}
                              onStartWork={folder() ? () => startDraft(projectWorkPrompt(item())) : undefined}
                              settings={
                                <ProjectDetails
                                  project={item()}
                                  directory={directory()}
                                  onArchived={() => navigate("/projects")}
                                />
                              }
                            />
                          )
                        }}
                      </Show>
                    </Show>
                  </Show>
                </main>
              }
            >
              {(open) => (
                <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                  {conflictBanner()}
                  <NotesPageView
                    client={client(open.directory)}
                    path={open.path}
                    pages={pageList()}
                    projects={projects()}
                    onBack={back}
                    onOpen={openPage}
                    onSaved={vault.store}
                    onDelete={deletePage}
                    onDirty={(dirty) => setState("dirty", dirty)}
                    held={held()}
                  />
                </div>
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
