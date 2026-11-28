import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { RevealShow } from "@tenon/ui/v2/reveal"
import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show, type JSX } from "solid-js"
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
  readVaultPage,
  removeVaultPage,
  SecondBrainRequestError,
  writeTimeline,
  writeVaultPage,
  type ProjectRecord,
  type Timeline,
  type TimelineItem,
  type VaultPageInfo,
} from "@/features/second-brain/client"
import { NotesPageView } from "@/features/second-brain/notes-page"
import { InboxView } from "@/features/second-brain/inbox-view"
import { DialogTemplatePage } from "@/features/second-brain/template-page-dialog"
import {
  applyTemplate,
  BUILT_IN_DAILY,
  DAILY_TEMPLATE_PATH,
  dailyNotePath,
  isTemplatePath,
  localDate,
  starterTemplate,
  TEMPLATES_FOLDER,
  templateName,
} from "@/features/second-brain/templates"
import { matchProjects, newPagePath } from "@/features/second-brain/notes-timeline"
import { ProjectCreate, projectWorkPrompt } from "@/features/second-brain/project-details"
import { ProjectView, sectionFromTab } from "@/features/second-brain/project-view"
import { ProjectCoverCard } from "@/features/second-brain/project-cover-card"
import { morphCover } from "@/features/second-brain/project-cover-cache"
import { PageEmpty, PageFrame, PageHeader } from "@/components/page"
import { searchFieldClass } from "@/components/surface-classes"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"
import { useVaultPages, vaultMigration } from "@/features/second-brain/vault-pages"
import { settled } from "@/utils/resource"
import { sessionHref } from "@/utils/session-route"
import { dismissToast, showToast } from "@/utils/toast"
import { createUndoQueue } from "@/utils/undo-action"

const NO_PAGES: ReadonlyArray<VaultPageInfo> = []
const listRowClass =
  "relative flex w-full min-w-0 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"

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
  const [search] = useSearchParams<{
    project?: string
    tab?: string
    section?: string
    page?: string
    note?: string
    new?: string
    from?: string
    daily?: string
    inbox?: string
  }>()
  const [state, setState] = createStore({
    directory: "",
    dirty: false,
    creating: false,
    error: "",
    moved: 0,
    search: "",
    query: "",
    archivedOpen: false,
    deleting: {} as Record<string, boolean>,
  })
  const directory = () => state.directory
  const client = (target: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory: target },
  })

  const sidebarDirectory = () => layout.home.workspace() ?? ""
  const held = () => state.dirty && sidebarDirectory() !== state.directory
  createEffect(() => {
    const next = sidebarDirectory()
    if (next === state.directory || state.dirty) return
    setState({ directory: next, error: "", moved: 0, search: "", query: "" })
  })

  const vault = useVaultPages(() => directory() || undefined)
  createEffect(() => {
    const moved = vault.moved()
    if (moved <= 0) return
    setState("moved", moved)
    vault.clearMoved()
  })
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
  const pageList = createMemo(() => (vault.pages() ?? []).filter(visible))
  const foundPages = () => (settled(matches) ?? []).filter(visible)
  const foundProjects = () => matchProjects(projects(), state.query)
  const projects = () => (held() ? [] : (brainProjects.list() ?? []))
  const known = createMemo(() => new Set(projects().map((item) => item.id)))
  const generalPages = createMemo(() => pageList().filter((page) => !page.projectId || !known().has(page.projectId)))
  const pagesByProject = createMemo(() => {
    const groups = new Map<string, VaultPageInfo[]>()
    for (const page of pageList()) {
      if (!page.projectId) continue
      const group = groups.get(page.projectId)
      if (group) group.push(page)
      else groups.set(page.projectId, [page])
    }
    return groups
  })
  const misplaced = () => {
    const error = vault.error()
    return error instanceof SecondBrainRequestError && error.reason === "vault_inside_workspace"
  }
  const unreadable = () => {
    const error = vault.error()
    return error instanceof SecondBrainRequestError && error.reason?.startsWith("vault_unavailable: ")
      ? error.reason.slice("vault_unavailable: ".length)
      : undefined
  }

  const pagePath = () => search.page ?? search.note ?? ""
  const projectId = () => (pagePath() ? "" : (search.project ?? ""))
  const section = () => sectionFromTab(search.section ?? search.tab)
  const project = createMemo(() => projects().find((item) => item.id === projectId()))

  const projectKey = () => (directory() && projectId() ? ([directory(), projectId()] as const) : undefined)
  const [timeline, timelineActions] = createResource(projectKey, ([target, id]) => readTimeline(client(target), id))
  const [log, logActions] = createResource(projectKey, ([target, id]) => readProjectLog(client(target), id))

  const timelineSaver =
    (
      currentKey: () => readonly [string, string] | undefined,
      current: () => Timeline | undefined,
      actions: { mutate: (value: Timeline) => unknown; refetch: () => unknown },
    ) =>
    async (items: ReadonlyArray<TimelineItem>) => {
      const key = currentKey()
      const loaded = current()
      if (!key || !loaded) return language.t("secondBrain.error.request")
      const result = await writeTimeline(client(key[0]), key[1], { items, expectedRevision: loaded.revision }).then(
        (saved) => ({ saved, error: undefined }),
        (error: unknown) => ({ saved: undefined, error }),
      )
      if (result.saved) {
        if (currentKey()?.[1] === key[1] && currentKey()?.[0] === key[0]) actions.mutate(result.saved)
        return ""
      }
      const stale = result.error instanceof SecondBrainRequestError && result.error.status === 409
      if (stale) void actions.refetch()
      return language.t(stale ? "secondBrain.vault.timeline.stale" : "secondBrain.error.request")
    }
  const saveItems = timelineSaver(projectKey, () => settled(timeline), timelineActions)

  const pageHref = (path: string) => `/projects?page=${encodeURIComponent(path)}`
  const openPage = (path: string) => navigate(pageHref(path), { state: { fromNotes: true } })
  const openProject = (id: string) => navigate(`/projects?project=${encodeURIComponent(id)}`)
  const openProjectFromCover = (id: string) => morphCover(id, () => openProject(id))
  const parentHref = () => {
    if (search.from === "routines") return "/routines"
    const owner = pageList().find((page) => page.path === pagePath())?.projectId
    return owner ? `/projects?project=${encodeURIComponent(owner)}&section=pages` : "/projects"
  }
  const back = () => (location.state?.fromNotes ? navigate(-1) : navigate(parentHref()))
  const threadDirectory = (record: ProjectRecord) =>
    brainProjects.entries()?.find((entry) => entry.project.id === record.id)?.threadDirectory ??
    layout.projects.list().find((location) => location.id === record.location?.workspaceId)?.worktree

  const projectFolder = () => {
    const record = project()
    return record ? threadDirectory(record) : undefined
  }
  createEffect(() => {
    const folder = projectFolder()
    if (folder) void serverSync().project.loadSessions(folder)
  })
  const rootThreads = (folder: string | undefined) => {
    if (!folder) return []
    return serverSync()
      .child(folder, { bootstrap: false })[0]
      .session.filter((session) => !session.parentID && !session.time.archived)
      .sort((left, right) => right.time.updated - left.time.updated)
  }
  const recentThreads = (folder: string | undefined) =>
    rootThreads(folder)
      .slice(0, 6)
      .map((session) => ({
        id: session.id,
        title: session.title || language.t("secondBrain.project.untitledThread"),
        updated: session.time.updated,
        running: serverSync().session.data.session_working(session.id),
      }))
  const threads = createMemo(() => recentThreads(projectFolder()))

  const templates = createMemo(() =>
    pageList()
      .filter((page) => isTemplatePath(page.path))
      .sort((left, right) => templateName(left.path).localeCompare(templateName(right.path))),
  )
  const templateBody = async (target: string, path: string | undefined) => {
    if (!path) return undefined
    return readVaultPage(client(target), path).then(
      (page) => page.body,
      () => undefined,
    )
  }

  const createPage = async (owner?: string, template?: { path: string; title: string }) => {
    const target = directory()
    if (!target || state.creating) return
    const folder = owner
      ? pageList()
          .find((page) => page.projectId === owner)
          ?.path.split("/")[0]
      : ""
    const title = template ? template.title : language.t("secondBrain.vault.untitled")
    setState({ creating: true, error: "" })
    const source = await templateBody(target, template?.path)
    const body = source === undefined ? "" : applyTemplate(source, { now: new Date(), title })
    const result = await writeVaultPage(client(target), {
      path: newPagePath(title, folder ?? "", pageList()),
      title,
      body,
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

  const dialog = useDialog()
  const askTemplateTitle = (path: string) =>
    void dialog.show(() => (
      <DialogTemplatePage
        template={templateName(path)}
        onCreate={(title) => void createPage(undefined, { path, title })}
      />
    ))

  const createTemplate = async () => {
    const target = directory()
    if (!target || state.creating) return
    const title = language.t("secondBrain.templates.newName")
    setState({ creating: true, error: "" })
    const result = await writeVaultPage(client(target), {
      path: `${TEMPLATES_FOLDER}/${newPagePath(title, TEMPLATES_FOLDER, pageList())}`,
      title,
      body: starterTemplate(language.t("secondBrain.templates.placeholders")),
      create: true,
    }).catch(() => undefined)
    setState("creating", false)
    if (!result) return setState("error", language.t("secondBrain.error.request"))
    if (target !== directory()) return
    vault.store(result.info)
    openPage(result.info.path)
  }

  const openDaily = async () => {
    const target = directory()
    if (!target || state.creating) return
    const now = new Date()
    const path = dailyNotePath(now)
    const existing = pageList().find((page) => page.path.toLowerCase() === path.toLowerCase())
    if (existing) return openPage(existing.path)
    setState({ creating: true, error: "" })
    const custom = pageList().find((page) => page.path.toLowerCase() === DAILY_TEMPLATE_PATH.toLowerCase())
    const source = (await templateBody(target, custom?.path)) ?? BUILT_IN_DAILY
    const title = localDate(now)
    const result = await writeVaultPage(client(target), {
      path,
      title,
      body: applyTemplate(source, { now, title }),
      create: true,
    }).then(
      (page) => ({ page, error: undefined }),
      (error: unknown) => ({ page: undefined, error }),
    )
    setState("creating", false)
    if (target !== directory()) return
    if (result.page) {
      vault.store(result.page.info)
      return openPage(result.page.info.path)
    }
    if (result.error instanceof SecondBrainRequestError && result.error.status === 409) return openPage(path)
    setState("error", language.t("secondBrain.error.request"))
  }

  createEffect(
    on(
      () => (search.daily && directory() && vault.pages() ? directory() : undefined),
      (ready) => {
        if (!ready) return
        navigate("/projects", { replace: true })
        void openDaily()
      },
    ),
  )

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

  const deletePage = (page: { path: string; title: string; revision: string }) => {
    const target = directory()
    const targetClient = client(target)
    const key = pageKey(target, page.path)
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
            class="mx-6 mt-3 flex items-center gap-2 rounded-[16px] bg-v2-background-bg-layer-01 py-1.5 pl-4 pr-1.5 text-[13px] text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] sm:mx-10"
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

  const conflictCopies = () => (
    <RevealShow when={(settled(conflicts) ?? []).length > 0 && settled(conflicts)} class="shrink-0">
      {(list) => (
        <div
          role="status"
          class="mx-6 mt-3 flex flex-col gap-1.5 rounded-[16px] bg-v2-background-bg-layer-01 px-4 py-3 text-[13px] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] sm:mx-10"
        >
          <p class="flex items-center gap-2 text-v2-text-text-base [font-weight:500]">
            <Icon name="warning" size="small" class="text-v2-icon-icon-muted" />
            {language.t("secondBrain.vault.conflicts.title")}
          </p>
          <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.vault.conflicts.body")}</p>
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
      <button
        type="button"
        class={`${listRowClass} flex-col gap-1.5`}
        data-project-row={record.id}
        onClick={() => openProject(record.id)}
      >
        <span class="flex w-full min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">{record.name}</span>
          <Show when={record.status === "paused"}>
            <span class="shrink-0 type-meta text-v2-text-text-muted">
              {language.t("secondBrain.projects.filter.paused")}
            </span>
          </Show>
          <span class="shrink-0 type-meta tabular-nums text-v2-text-text-muted">{record.progressPercent}%</span>
        </span>
        <span class="block h-1 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-03" aria-hidden="true">
          <span
            class="block h-full rounded-full bg-v2-background-bg-accent"
            style={{ width: `${record.progressPercent}%` }}
          />
        </span>
      </button>
    </li>
  )
  const pageRow = (page: VaultPageInfo) => (
    <li>
      <button
        type="button"
        class={`${listRowClass} items-center gap-2.5 type-row-title`}
        onClick={() => openPage(page.path)}
      >
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
            <span class="shrink-0 truncate type-meta text-v2-text-text-muted">
              {projects().find((item) => item.id === id())?.name}
            </span>
          )}
        </Show>
      </button>
    </li>
  )
  const sectionTitle = (id: string, text: string) => (
    <h2 id={id} class="px-3 pt-1 type-caption text-v2-text-text-muted">
      {text}
    </h2>
  )

  const inboxView = () => (
    <Show when={directory()} keyed>
      {(target) => (
        <InboxView
          client={client(target)}
          projects={projects()}
          pages={pageList()}
          onBack={() => navigate("/projects")}
          onHandToAgent={(text, record) => {
            const folder = record ? threadDirectory(record) : target
            void drafts.create(
              { server: server.key, directory: folder ?? target, ...(record ? { projectID: record.id } : {}) },
              language.t("secondBrain.inbox.prompt", { text }),
            )
          }}
        />
      )}
    </Show>
  )

  const landing = () => {
    const active = () => projects().filter((record) => record.status !== "archived")
    const archived = () => projects().filter((record) => record.status === "archived")
    const coverGrid = (records: ReadonlyArray<ProjectRecord>, extra?: JSX.Element) => (
      <div class="grid grid-cols-1 gap-x-6 gap-y-7 @min-[620px]:grid-cols-2 @min-[960px]:grid-cols-3">
        <For each={records}>
          {(record, index) => (
            <ProjectCoverCard
              project={record}
              directory={directory()}
              index={index()}
              onOpen={() => openProjectFromCover(record.id)}
            />
          )}
        </For>
        {extra}
      </div>
    )
    return (
      <div class="@container flex min-h-0 flex-1 flex-col">
        <PageHeader
          id="projects-title"
          column="split"
          title={language.t("secondBrain.projects.title")}
          actions={
            <>
              <ButtonV2 variant="ghost" icon="calendar" disabled={state.creating} onClick={() => void openDaily()}>
                {language.t("secondBrain.daily.open")}
              </ButtonV2>
              <ButtonV2 variant="ghost" icon="archive" onClick={() => navigate("/projects?inbox=1")}>
                {language.t("secondBrain.inbox.open")}
              </ButtonV2>
              <ButtonV2 variant="ghost" icon="plus" disabled={state.creating} onClick={() => void createPage()}>
                {language.t("secondBrain.vault.newPage")}
              </ButtonV2>
              <MenuV2 gutter={4} modal={false} placement="bottom-end">
                <MenuV2.Trigger
                  as={IconButtonV2}
                  variant="ghost-muted"
                  class="!size-8"
                  disabled={state.creating}
                  icon={<Icon name="chevron-down" size="small" />}
                  aria-label={language.t("secondBrain.templates.menu")}
                />
                <MenuV2.Portal>
                  <MenuV2.Content>
                    <MenuV2.Group>
                      <MenuV2.GroupLabel>{language.t("secondBrain.templates.menu")}</MenuV2.GroupLabel>
                      <For each={templates()}>
                        {(template) => (
                          <MenuV2.Item onSelect={() => requestAnimationFrame(() => askTemplateTitle(template.path))}>
                            {templateName(template.path)}
                          </MenuV2.Item>
                        )}
                      </For>
                    </MenuV2.Group>
                    <Show when={templates().length > 0}>
                      <MenuV2.Separator />
                    </Show>
                    <MenuV2.Item onSelect={() => void createTemplate()}>
                      {language.t("secondBrain.templates.create")}
                    </MenuV2.Item>
                  </MenuV2.Content>
                </MenuV2.Portal>
              </MenuV2>
              <ButtonV2
                variant="contrast"
                icon="plus"
                data-action="new-project"
                onClick={() => navigate("/projects?new=1")}
              >
                {language.t("secondBrain.projects.new")}
              </ButtonV2>
            </>
          }
        />
        <div class="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-6 pb-10 pt-3 sm:px-10">
          <RevealShow when={state.error}>
            {(error) => (
              <p role="alert" class="type-meta text-v2-text-text-critical">
                {error()}
              </p>
            )}
          </RevealShow>
          <label class="relative block w-full max-w-[360px] shrink-0">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" />
            </span>
            <input
              class={`${searchFieldClass} !rounded-[10px]`}
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
                fallback={<p class="type-meta text-v2-text-text-muted">{language.t("common.loading")}</p>}
              >
                <Show
                  when={foundProjects().length + foundPages().length > 0}
                  fallback={
                    <PageEmpty error={!!matches.error}>
                      {language.t(matches.error ? "common.requestFailed" : "secondBrain.vault.noMatches")}
                    </PageEmpty>
                  }
                >
                  <ul
                    class="-mx-3 flex max-w-[720px] flex-col gap-0.5"
                    aria-label={language.t("secondBrain.vault.results")}
                  >
                    <For each={foundProjects()}>{(record) => projectRow(record)}</For>
                    <For each={foundPages()}>{(page) => pageRow(page)}</For>
                  </ul>
                </Show>
              </Show>
            }
          >
            <section aria-labelledby="projects-list-title" class="flex flex-col gap-4">
              <div class="flex items-center gap-2">
                <h2 id="projects-list-title" class="type-section text-v2-text-text-base">
                  {language.t("secondBrain.vault.projects")}
                </h2>
                <span class="type-meta tabular-nums text-v2-text-text-muted">{active().length}</span>
                <span class="flex-1" />
                <ButtonV2 size="small" variant="ghost" onClick={() => navigate("/projects/overview")}>
                  {language.t("secondBrain.projects.overview.title")}
                </ButtonV2>
              </div>
              <Show
                when={!brainProjects.loading() && active().length === 0}
                fallback={coverGrid(
                  active(),
                  <button
                    type="button"
                    class="-m-1.5 flex min-w-0 flex-col gap-2.5 rounded-[18px] p-1.5 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                    onClick={() => navigate("/projects?new=1")}
                  >
                    <span class="flex h-[132px] w-full items-center justify-center rounded-[20px] text-v2-icon-icon-muted shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                      <Icon name="plus" />
                    </span>
                    <span class="px-1 type-row-title text-v2-text-text-muted">
                      {language.t("secondBrain.projects.new")}
                    </span>
                  </button>,
                )}
              >
                <p class="type-control text-v2-text-text-muted">{language.t("secondBrain.projects.emptyActive")}</p>
              </Show>
              <Show when={archived().length > 0}>
                <button
                  type="button"
                  aria-expanded={state.archivedOpen}
                  class="-ml-3 flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
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
                <RevealShow when={state.archivedOpen}>
                  {() => (
                    <div aria-label={language.t("secondBrain.projects.filter.archived")} role="group">
                      {coverGrid(archived())}
                    </div>
                  )}
                </RevealShow>
              </Show>
            </section>
            <section aria-labelledby="projects-general-title" class="flex max-w-[720px] flex-col gap-1">
              <h2 id="projects-general-title" class="type-section text-v2-text-text-base">
                {language.t("secondBrain.vault.general")}
              </h2>
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
                    <p class="py-2 type-control text-v2-text-text-muted">
                      {vault.loading() ? language.t("common.loading") : language.t("secondBrain.project.generalEmpty")}
                    </p>
                  }
                >
                  <ul class="-mx-3 flex flex-col gap-0.5">
                    <For each={generalPages()}>{(page) => pageRow(page)}</For>
                  </ul>
                </Show>
              </Show>
            </section>
          </Show>
        </div>
      </div>
    )
  }

  return (
    <PageFrame label={language.t("secondBrain.projects.title")} scroll={false}>
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
          when={!misplaced() && !unreadable()}
          fallback={
            <PageEmpty
              error
              title={language.t(
                misplaced() ? "secondBrain.vault.misplaced.title" : "secondBrain.vault.unavailable.title",
              )}
              action={
                unreadable() ? (
                  <ButtonV2 size="small" variant="outline" onClick={vault.retry}>
                    {language.t("secondBrain.state.retry")}
                  </ButtonV2>
                ) : undefined
              }
            >
              {misplaced()
                ? language.t("secondBrain.vault.misplaced.body")
                : language.t("secondBrain.vault.unavailable.body", { file: unreadable() ?? "" })}
            </PageEmpty>
          }
        >
          <Show
            when={pagePath() ? { path: pagePath(), directory: directory() } : undefined}
            keyed
            fallback={
              <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                {conflictBanner()}
                <Show
                  when={search.new !== "1"}
                  fallback={
                    <ProjectCreate
                      directory={directory()}
                      onCreated={(created) => {
                        vault.retry()
                        openProject(created.id)
                      }}
                      onCancel={() => navigate("/projects")}
                    />
                  }
                >
                  <Show when={projectId()} fallback={search.inbox ? inboxView() : landing()}>
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
                            directory={directory()}
                            onArchived={() => navigate("/projects")}
                            onBack={() => morphCover(item().id, () => navigate("/projects"))}
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
                            pages={pagesByProject().get(item().id) ?? NO_PAGES}
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
                          />
                        )
                      }}
                    </Show>
                  </Show>
                </Show>
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
                  onSaved={vault.store}
                  onDelete={deletePage}
                  onMoved={(from, page, updatedLinks) => {
                    vault.remove(from)
                    vault.store(page.info)
                    if (updatedLinks > 0) vault.retry()
                    navigate(pageHref(page.info.path), { replace: true, state: location.state })
                    showToast({
                      title: language.t("secondBrain.vault.move.done", { title: page.info.title }),
                      description:
                        updatedLinks > 0
                          ? language.t("secondBrain.vault.move.linksUpdated", { count: updatedLinks })
                          : undefined,
                    })
                  }}
                  onDirty={(dirty) => setState("dirty", dirty)}
                  held={held()}
                />
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </PageFrame>
  )
}
