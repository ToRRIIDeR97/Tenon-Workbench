import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageHeader, pageWideColumnClass } from "@/components/page"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { INBOX_PATH } from "@/features/desktop-widget/inbox"
import {
  readCalendar,
  readVaultPage,
  SecondBrainRequestError,
  writeCalendar,
  writeVaultPage,
  type PlannerTask,
  type ProjectRecord,
  type VaultPageInfo,
} from "./client"
import { inboxNewestFirst, inboxTaskTitle, parseInbox, removeInboxEntry, type InboxEntry } from "./inbox-triage"
import { localDate } from "./templates"
import { CALENDAR_CHANGED } from "./calendar-cache"

type VaultClient = Parameters<typeof readVaultPage>[0]

const INBOX_NOTES = "Inbox notes"

const missing = (error: unknown) => error instanceof SecondBrainRequestError && error.status === 404
const stale = (error: unknown) => error instanceof SecondBrainRequestError && error.status === 409

async function readInbox(client: VaultClient) {
  return readVaultPage(client, INBOX_PATH).catch((error: unknown) => {
    if (missing(error)) return undefined
    throw error
  })
}

async function dropEntry(client: VaultClient, entry: InboxEntry) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const page = await readInbox(client)
    if (!page) return
    const match = parseInbox(page.body).find((item) => item.at === entry.at && item.text === entry.text)
    if (!match) return
    const saved = await writeVaultPage(client, {
      path: INBOX_PATH,
      body: removeInboxEntry(page.body, match.id),
      expectedRevision: page.revision,
    }).then(
      () => true,
      (error: unknown) => {
        if (stale(error)) return false
        throw error
      },
    )
    if (saved) return
  }
  throw new SecondBrainRequestError(409)
}

async function addTask(client: VaultClient, entry: InboxEntry, dueDate: string | undefined) {
  const now = new Date().toISOString()
  const task: PlannerTask = {
    id: crypto.randomUUID(),
    title: inboxTaskTitle(entry.text) || entry.label,
    notes: entry.text,
    ...(dueDate ? { dueDate } : {}),
    createdAt: now,
    updatedAt: now,
    source: "local",
    syncState: "local",
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readCalendar(client)
    const saved = await writeCalendar(client, snapshot.events, snapshot.revision, [...snapshot.tasks, task]).then(
      () => true,
      (error: unknown) => {
        if (stale(error)) return false
        throw error
      },
    )
    if (saved) {
      window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED))
      return
    }
  }
  throw new SecondBrainRequestError(409)
}

async function addToProject(
  client: VaultClient,
  entry: InboxEntry,
  project: ProjectRecord,
  pages: ReadonlyArray<VaultPageInfo>,
) {
  const block = `## ${entry.label} · ${entry.at}\n\n${entry.text}\n`
  const known = pages.find(
    (page) =>
      page.projectId === project.id && page.path.split("/").pop()?.toLowerCase() === `${INBOX_NOTES}.md`.toLowerCase(),
  )
  if (!known) {
    const created = await writeVaultPage(client, {
      path: `${INBOX_NOTES}.md`,
      title: INBOX_NOTES,
      body: `# ${INBOX_NOTES}\n\n${block}`,
      projectId: project.id,
      create: true,
    }).then(
      () => true,
      (error: unknown) => {
        if (stale(error)) return false
        throw error
      },
    )
    if (created) return
  }
  const path = known?.path ?? `${project.name}/${INBOX_NOTES}.md`
  const page = await readVaultPage(client, path)
  await writeVaultPage(client, {
    path,
    body: `${page.body.replace(/\s+$/, "")}\n\n${block}`,
    expectedRevision: page.revision,
  })
}

export function InboxView(props: {
  client: VaultClient
  projects: ReadonlyArray<ProjectRecord>
  pages: ReadonlyArray<VaultPageInfo>
  onBack: () => void
  onHandToAgent: (text: string, project: ProjectRecord | undefined) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ busy: {} as Record<string, boolean> })
  const [inbox, actions] = createResource(() => readInbox(props.client))
  const entries = () => inboxNewestFirst(parseInbox(inbox.latest?.body ?? ""))
  const active = () => props.projects.filter((project) => project.status !== "archived")
  const day = (offset: number) => {
    const now = new Date()
    return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12))
  }

  const act = async (entry: InboxEntry, run: () => Promise<unknown>, done: string) => {
    if (state.busy[entry.id]) return
    setState("busy", entry.id, true)
    const ok = await run().then(
      () => dropEntry(props.client, entry).then(() => true),
      () => false,
    )
    setState("busy", entry.id, false)
    if (!ok) return showToast({ variant: "error", title: language.t("secondBrain.error.request") })
    showToast({ title: done })
    void actions.refetch()
  }

  return (
    <article class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-component="inbox-view">
      <PageHeader
        crumb
        column="wide"
        title={language.t("secondBrain.inbox.title")}
        back={{ label: language.t("secondBrain.vault.back"), onClick: props.onBack }}
      />
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class={`${pageWideColumnClass} min-h-full`}>
          <Show when={!inbox.error} fallback={<PageEmpty error>{language.t("common.requestFailed")}</PageEmpty>}>
            <Show
              when={entries().length > 0}
              fallback={
                <Show when={!inbox.loading}>
                  <PageEmpty title={language.t("secondBrain.inbox.empty.title")}>
                    {language.t("secondBrain.inbox.empty.body")}
                  </PageEmpty>
                </Show>
              }
            >
              <ul class="m-0 flex list-none flex-col gap-3 p-0" aria-label={language.t("secondBrain.inbox.title")}>
                <For each={entries()}>
                  {(entry) => (
                    <li class="flex flex-col gap-3 rounded-[16px] bg-v2-background-bg-base p-4 shadow-[0_0_0_1px_var(--v2-border-border-muted)]">
                      <div class="flex items-center gap-2 type-meta text-v2-text-text-muted">
                        <span>{entry.label}</span>
                        <span aria-hidden="true">·</span>
                        <time datetime={entry.at} class="tabular-nums">
                          {new Date(entry.at).toLocaleString(language.intl(), {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p class="m-0 whitespace-pre-wrap text-[14px] leading-6 text-v2-text-text-base">{entry.text}</p>
                      <div class="flex flex-wrap items-center gap-2">
                        <MenuV2 gutter={4} modal={false} placement="bottom-start">
                          <MenuV2.Trigger as={ButtonV2} size="small" variant="outline" disabled={state.busy[entry.id]}>
                            {language.t("secondBrain.inbox.makeTask")}
                          </MenuV2.Trigger>
                          <MenuV2.Portal>
                            <MenuV2.Content>
                              <For
                                each={
                                  [
                                    ["secondBrain.inbox.due.none", undefined],
                                    ["secondBrain.inbox.due.today", day(0)],
                                    ["secondBrain.inbox.due.tomorrow", day(1)],
                                    ["secondBrain.inbox.due.nextWeek", day(7)],
                                  ] as const
                                }
                              >
                                {([key, due]) => (
                                  <MenuV2.Item
                                    onSelect={() =>
                                      void act(
                                        entry,
                                        () => addTask(props.client, entry, due),
                                        language.t("secondBrain.inbox.taskMade"),
                                      )
                                    }
                                  >
                                    {language.t(key)}
                                  </MenuV2.Item>
                                )}
                              </For>
                            </MenuV2.Content>
                          </MenuV2.Portal>
                        </MenuV2>
                        <MenuV2 gutter={4} modal={false} placement="bottom-start">
                          <MenuV2.Trigger
                            as={ButtonV2}
                            size="small"
                            variant="outline"
                            disabled={state.busy[entry.id] || active().length === 0}
                          >
                            {language.t("secondBrain.inbox.addToProject")}
                          </MenuV2.Trigger>
                          <MenuV2.Portal>
                            <MenuV2.Content>
                              <For each={active()}>
                                {(project) => (
                                  <MenuV2.Item
                                    onSelect={() =>
                                      void act(
                                        entry,
                                        () => addToProject(props.client, entry, project, props.pages),
                                        language.t("secondBrain.inbox.added", { project: project.name }),
                                      )
                                    }
                                  >
                                    {project.name}
                                  </MenuV2.Item>
                                )}
                              </For>
                            </MenuV2.Content>
                          </MenuV2.Portal>
                        </MenuV2>
                        <MenuV2 gutter={4} modal={false} placement="bottom-start">
                          <MenuV2.Trigger as={ButtonV2} size="small" variant="outline" disabled={state.busy[entry.id]}>
                            {language.t("secondBrain.inbox.handToAgent")}
                          </MenuV2.Trigger>
                          <MenuV2.Portal>
                            <MenuV2.Content>
                              <MenuV2.Item
                                onSelect={() =>
                                  void act(
                                    entry,
                                    async () => props.onHandToAgent(entry.text, undefined),
                                    language.t("secondBrain.inbox.handed"),
                                  )
                                }
                              >
                                {language.t("secondBrain.inbox.handToWorkspace")}
                              </MenuV2.Item>
                              <For each={active()}>
                                {(project) => (
                                  <MenuV2.Item
                                    onSelect={() =>
                                      void act(
                                        entry,
                                        async () => props.onHandToAgent(entry.text, project),
                                        language.t("secondBrain.inbox.handed"),
                                      )
                                    }
                                  >
                                    {project.name}
                                  </MenuV2.Item>
                                )}
                              </For>
                            </MenuV2.Content>
                          </MenuV2.Portal>
                        </MenuV2>
                        <ButtonV2
                          size="small"
                          variant="ghost"
                          disabled={state.busy[entry.id]}
                          onClick={() =>
                            void act(entry, async () => undefined, language.t("secondBrain.inbox.cleared"))
                          }
                        >
                          {language.t("secondBrain.inbox.done")}
                        </ButtonV2>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </div>
    </article>
  )
}
