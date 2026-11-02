import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
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
  writeVaultPage,
  type VaultPageInfo,
} from "@/features/second-brain/client"
import { NotesPageView } from "@/features/second-brain/notes-page"
import { NotesProject, projectTabs, type ProjectTab } from "@/features/second-brain/notes-project"
import { newPagePath } from "@/features/second-brain/notes-timeline"
import { NotesTree } from "@/features/second-brain/notes-tree"
import { PageEmpty, pagePanelClass, pageRowClass } from "@/components/page"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"

/**
 * Notes over the Tenon vault. URL contract: `/notes`, `/notes?project=<id>&tab=<view>`, `/notes?page=<path>`.
 * A page opened from a Project keeps that Project's URL in history, so Back returns to the same view.
 */
export default function NotesPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation<{ fromNotes?: boolean }>()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const command = useCommand()
  const brainProjects = useBrainProjects()
  // `note` is the pre-vault link form (wiki links in page previews still use it).
  const [search] = useSearchParams<{ project?: string; tab?: string; page?: string; note?: string }>()
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
  const [conflicts] = createResource(
    () => directory() || undefined,
    (target) => listVaultConflicts(client(target)).catch(() => []),
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

  const pageHref = (path: string) => `/notes?page=${encodeURIComponent(path)}`
  const openPage = (path: string) => navigate(pageHref(path), { state: { fromNotes: true } })
  const openProject = (id: string) => navigate(`/notes?project=${encodeURIComponent(id)}`)
  const back = () => {
    if (location.state?.fromNotes) return navigate(-1)
    const owner = pageList().find((page) => page.path === pagePath())?.projectId
    navigate(owner ? `/notes?project=${encodeURIComponent(owner)}&tab=docs` : "/notes")
  }

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
      <div class="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3 pt-1">
        <h1 class="min-w-0 flex-1 truncate text-[17px] leading-6 text-v2-text-text-base [font-weight:600]">
          {language.t("secondBrain.notes.title")}
        </h1>
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
      <Show when={state.error}>
        <p role="alert" class="px-5 pb-2 text-[12px] text-v2-text-text-critical">
          {state.error}
        </p>
      </Show>
      <label class="relative mx-3 mb-2 block shrink-0">
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
      <Show when={state.moved > 0}>
        <div
          role="status"
          class="mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-[16px] bg-v2-background-bg-layer-01 py-1.5 pl-4 pr-1.5 text-[13px] text-v2-text-text-base sm:mx-6"
        >
          <span class="min-w-0 flex-1">
            {language.plural("secondBrain.vault.moved", state.moved, {
              count: state.moved.toLocaleString(language.intl()),
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
      </Show>
      {conflictCopies()}
    </>
  )

  const conflictCopies = () => (
    <Show when={(conflicts.latest ?? []).length > 0}>
      <div
        role="status"
        class="mx-4 mt-3 flex shrink-0 flex-col gap-1.5 rounded-[16px] bg-v2-background-bg-layer-01 px-4 py-3 text-[13px] sm:mx-6"
      >
        <p class="flex items-center gap-2 text-v2-text-text-base [font-weight:500]">
          <Icon name="warning" size="small" class="text-v2-icon-icon-muted" />
          {language.t("secondBrain.vault.conflicts.title")}
        </p>
        <p class="text-[12px] text-v2-text-text-muted">{language.t("secondBrain.vault.conflicts.body")}</p>
        <ul class="flex flex-wrap gap-1.5">
          <For each={conflicts.latest}>
            {(conflict) => (
              <li>
                <button
                  type="button"
                  title={conflict.path}
                  class="max-w-80 truncate rounded-full bg-v2-background-bg-layer-02 px-2.5 py-1 text-[12px] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-03 motion-reduce:transition-none"
                  onClick={() => openPage(conflict.path)}
                >
                  {conflictName(conflict.path)}
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )

  const overview = () => (
    <div class="mx-auto flex w-full max-w-[860px] flex-col gap-2 px-6 pb-8 pt-8 sm:px-10">
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
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-label={language.t("secondBrain.notes.title")}>
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
                <div class="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
                  {tree()}
                  <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                    {conflictBanner()}
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
                              navigate(`/notes?project=${encodeURIComponent(item().id)}&tab=${next}`, { replace: true })
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
                          />
                        )}
                      </Show>
                    </Show>
                  </main>
                </div>
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
          </Show>
        </Show>
      </div>
    </section>
  )
}

const migratedKey = "tenon.notes.migrated:"
const migrated = new Set<string>()

/**
 * Ask the server once per workspace to move pre-vault notes in (it backs them up and a repeat moves nothing).
 * A failed call is retried on the next visit; the page list then reports any lasting failure.
 */
async function migrateOnce(client: Parameters<typeof migrateVault>[0], directory: string) {
  if (migrated.has(directory) || storedFlag(directory)) return 0
  const result = await migrateVault(client).catch(() => undefined)
  if (!result) return 0
  migrated.add(directory)
  try {
    localStorage.setItem(migratedKey + directory, "1")
  } catch {
    // Blocked storage only costs one repeat request next launch, which moves nothing.
  }
  return result.moved
}

function storedFlag(directory: string) {
  try {
    return localStorage.getItem(migratedKey + directory) === "1"
  } catch {
    return false
  }
}
