import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import {
  listVaultConflicts,
  listVaultPages,
  migrateVault,
  readProjectLog,
  readTimeline,
  SecondBrainRequestError,
  writeTimeline,
  writeVaultPage,
  type TimelineItem,
  type VaultPageInfo,
} from "@/features/second-brain/client"
import { NotesPageView } from "@/features/second-brain/notes-page"
import { NotesProject, projectTabs, type ProjectTab } from "@/features/second-brain/notes-project"
import { newPagePath } from "@/features/second-brain/notes-timeline"
import { NotesTree } from "@/features/second-brain/notes-tree"
import { ProjectCreate, ProjectDetails } from "@/features/second-brain/project-details"
import { PageEmpty, pagePanelClass, pageRowClass } from "@/components/page"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"

/**
 * Projects: every Project and page in the Tenon vault, in one tree. URL contract: `/projects`,
 * `/projects?project=<id>&tab=<view>`, `/projects?page=<path>`, `/projects?new=1` (the New Project form).
 * `/notes` links redirect here. A page opened from a Project keeps that Project's URL in history, so Back returns to
 * the same view.
 */
export default function ProjectsPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation<{ fromNotes?: boolean }>()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const command = useCommand()
  const brainProjects = useBrainProjects()
  // `note` is the pre-vault link form (wiki links in page previews still use it).
  const [search] = useSearchParams<{ project?: string; tab?: string; page?: string; note?: string; new?: string }>()
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

  // The first visit to a workspace moves its pre-vault notes in, then lists the vault.
  const [pages, pagesActions] = createResource(
    () => directory() || undefined,
    async (target) => {
      const moved = await migrateOnce(client(target), target)
      if (moved > 0 && target === state.directory) setState("moved", moved)
      return listVaultPages(client(target))
    },
  )
  // Waits for the move above, which the server would otherwise make (and report) on this first vault read.
  const [conflicts] = createResource(
    () => directory() || undefined,
    async (target) => {
      await migrating.get(target)
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
  const pageList = () => (pages.error ? [] : (pages.latest ?? []))
  const projects = () => (held() ? [] : (brainProjects.list() ?? []))
  // The vault refuses to live inside a workspace or Project folder; say so instead of a generic failure.
  const misplaced = () =>
    pages.error instanceof SecondBrainRequestError && pages.error.reason === "vault_inside_workspace"

  const pagePath = () => search.page ?? search.note ?? ""
  const projectId = () => (pagePath() ? "" : (search.project ?? ""))
  const tab = (): ProjectTab => projectTabs.find((item) => item === search.tab) ?? "timeline"
  const project = createMemo(() => projects().find((item) => item.id === projectId()))
  const activeProject = () => projectId() || pageList().find((page) => page.path === pagePath())?.projectId || undefined

  const projectKey = () => (directory() && projectId() ? ([directory(), projectId()] as const) : undefined)
  const [timeline, timelineActions] = createResource(projectKey, ([target, id]) => readTimeline(client(target), id))
  const [log, logActions] = createResource(projectKey, ([target, id]) => readProjectLog(client(target), id))

  // Saves the Project's items over the revision on screen; a stale save reloads the timeline instead.
  const saveItems = async (items: ReadonlyArray<TimelineItem>) => {
    const key = projectKey()
    const current = timeline.error ? undefined : timeline.latest
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
  const back = () => {
    if (location.state?.fromNotes) return navigate(-1)
    const owner = pageList().find((page) => page.path === pagePath())?.projectId
    navigate(owner ? `/projects?project=${encodeURIComponent(owner)}&tab=docs` : "/projects")
  }
  // Folder Projects run their threads in the folder the server resolves; a legacy card in its linked workspace.
  const threadDirectory = (id: string) =>
    brainProjects.entries()?.find((entry) => entry.project.id === id)?.threadDirectory ??
    layout.projects.list().find((location) => location.id === project()?.location?.workspaceId)?.worktree

  const storePage = (info: VaultPageInfo) =>
    pagesActions.mutate((items) => (items ? [info, ...items.filter((item) => item.path !== info.path)] : items))

  // New page goes into the open Project (or the open page's Project), else the workspace; it opens right away.
  const createPage = async () => {
    const target = directory()
    if (!target || state.creating) return
    const owner = activeProject()
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
    storePage(result.page.info)
    openPage(result.page.info.path)
  }

  const conflictName = (path: string) => path.split("/").pop() ?? path

  const tree = () => (
    <aside class="flex max-h-[240px] w-full shrink-0 flex-col overflow-hidden md:max-h-none md:w-[256px]">
      {/* Same height and top inset as PageHeader and the open page's header beside it; the title lines up with the
          tree rows. An h2: a Project or page view holds the one h1. */}
      <div class="flex min-h-14 shrink-0 items-center gap-2 pl-4 pr-3 pt-3">
        <h2 class="min-w-0 flex-1 truncate text-[17px] leading-6 text-v2-text-text-base [font-weight:600]">
          {language.t("secondBrain.projects.title")}
        </h2>
        <TooltipV2 value={language.t("secondBrain.projects.new")}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            class="!size-8"
            data-action="new-project"
            aria-label={language.t("secondBrain.projects.new")}
            icon={<Icon name="folder-add-left" size="small" />}
            onClick={() => navigate("/projects?new=1")}
          />
        </TooltipV2>
        <TooltipV2 value={language.t("secondBrain.vault.newPage")}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            class="!size-8"
            aria-label={language.t("secondBrain.vault.newPage")}
            icon={<Icon name="plus" size="small" />}
            disabled={state.creating}
            onClick={() => void createPage()}
          />
        </TooltipV2>
      </div>
      <RevealShow when={state.error}>
        {(error) => (
          <p role="alert" class="px-4 pb-2 text-[12px] text-v2-text-text-critical">
            {error()}
          </p>
        )}
      </RevealShow>
      <label class="relative mx-2 mb-2 block shrink-0">
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
      <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label={language.t("secondBrain.vault.tree")}>
        <Show
          when={!pages.error}
          fallback={
            <PageEmpty
              class="!px-3"
              error
              title={language.t("secondBrain.state.error.title")}
              action={
                <ButtonV2 size="small" variant="outline" onClick={() => void pagesActions.refetch()}>
                  {language.t("secondBrain.state.retry")}
                </ButtonV2>
              }
            >
              {language.t("secondBrain.state.error.body")}
            </PageEmpty>
          }
        >
          <Show
            when={state.search.trim()}
            fallback={
              <NotesTree
                projects={projects()}
                pages={pageList()}
                activeProject={activeProject()}
                activePage={pagePath() || undefined}
                onProject={openProject}
                onPage={openPage}
              />
            }
          >
            <Show
              when={!matches.loading && state.query}
              fallback={<p class="px-3 py-2 text-[12px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
            >
              <Show
                when={(matches.error ? [] : (matches.latest ?? [])).length > 0}
                fallback={<PageEmpty class="!px-3">{language.t("secondBrain.vault.noMatches")}</PageEmpty>}
              >
                <ul class="flex flex-col gap-px" aria-label={language.t("secondBrain.vault.results")}>
                  <For each={matches.error ? [] : matches.latest}>
                    {(page) => (
                      <li>
                        <button
                          type="button"
                          class={`${pageRowClass} !py-2 text-[13px] text-v2-text-text-base`}
                          onClick={() => openPage(page.path)}
                        >
                          <span class="min-w-0 flex-1 truncate">{page.title}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </Show>
      </nav>
    </aside>
  )

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
    <RevealShow when={(conflicts.latest ?? []).length > 0 && conflicts.latest} class="shrink-0">
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

  const overview = () => (
    <div class="mx-auto flex w-full max-w-[860px] flex-col gap-2 px-6 pb-8 pt-8 sm:px-10">
      {/* Every Project's next milestone, upcoming items and recent pages, across the workspace. */}
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
      <Show
        when={pageList().length > 0}
        fallback={
          <PageEmpty
            loading={pages.loading}
            title={pages.loading ? language.t("common.loading") : language.t("secondBrain.vault.noPages")}
          >
            {pages.loading ? undefined : language.t("secondBrain.vault.select")}
          </PageEmpty>
        }
      >
        <h2 class="px-3 text-[12px] text-v2-text-text-muted [font-weight:500]">
          {language.t("secondBrain.vault.recent")}
        </h2>
        <ul class="flex flex-col gap-px">
          <For each={pageList().slice(0, 12)}>
            {(page) => (
              <li>
                <button type="button" class={`${pageRowClass} text-[14px]`} onClick={() => openPage(page.path)}>
                  <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{page.title}</span>
                  <Show when={page.projectId}>
                    {(id) => (
                      <span class="shrink-0 truncate text-[12px] text-v2-text-text-faint">
                        {projects().find((item) => item.id === id())?.name}
                      </span>
                    )}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )

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
            {/* F: the page tree stays beside whatever is open, a Project's views or a page. */}
            <div class="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
              {tree()}
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
                    <Show when={projectId()} fallback={overview()}>
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
                          />
                        }
                      >
                        {(item) => (
                          <NotesProject
                            project={item()}
                            tab={tab()}
                            onTab={(next) =>
                              navigate(`/projects?project=${encodeURIComponent(item().id)}&tab=${next}`, { replace: true })
                            }
                            timeline={{
                              value: timeline.error ? undefined : timeline.latest,
                              loading: timeline.loading,
                              failed: !!timeline.error,
                              retry: () => void timelineActions.refetch(),
                            }}
                            log={{
                              value: log.error ? undefined : log.latest,
                              loading: log.loading,
                              failed: !!log.error,
                              retry: () => void logActions.refetch(),
                            }}
                            pages={pageList().filter((page) => page.projectId === item().id)}
                            pageHref={pageHref}
                            onPage={openPage}
                            onSaveItems={saveItems}
                            calendarHref={`/calendar?project=${encodeURIComponent(item().id)}`}
                            details={
                              <ProjectDetails
                                project={item()}
                                directory={directory()}
                                threadDirectory={threadDirectory(item().id)}
                                onArchived={() => navigate("/projects")}
                              />
                            }
                          />
                        )}
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
                      onSaved={storePage}
                      onDirty={(dirty) => setState("dirty", dirty)}
                      held={held()}
                    />
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}

const migratedKey = "tenon.notes.migrated:"
const migrated = new Set<string>()
/** The migration request in flight per workspace, so other vault reads can wait for it. */
const migrating = new Map<string, Promise<number>>()

/**
 * Ask the server once per workspace to move pre-vault notes in (it backs them up and a repeat moves nothing).
 * A failed call is retried on the next visit; the page list then reports any lasting failure. The server also
 * moves them on its first vault request, so this call mainly reports how many moved.
 */
function migrateOnce(client: Parameters<typeof migrateVault>[0], directory: string) {
  if (migrated.has(directory) || storedFlag(directory)) return Promise.resolve(0)
  const running = migrating.get(directory)
  if (running) return running.then(() => 0)
  const request = migrateVault(client)
    .then((result) => {
      migrated.add(directory)
      try {
        localStorage.setItem(migratedKey + directory, "1")
      } catch {
        // Blocked storage only costs one repeat request next launch, which moves nothing.
      }
      return result.moved
    })
    .catch(() => 0)
    .finally(() => migrating.delete(directory))
  migrating.set(directory, request)
  return request
}

function storedFlag(directory: string) {
  try {
    return localStorage.getItem(migratedKey + directory) === "1"
  } catch {
    return false
  }
}
