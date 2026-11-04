import { A, useNavigate, useSearchParams } from "@solidjs/router"
import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { createEffect, createResource, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageHeader, pagePanelClass, pageRowClass } from "@/components/page"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { ComposerModelPill, createComposerHarness } from "@/components/prompt-input/composer-harness"
import { DialogArchivedThreads } from "@/components/sidebar/dialog-archived-threads"
import { useSidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { useCommandCentre, type CommandThread } from "@/features/command-centre/command-centre"
import { searchCommandMemory } from "@/features/second-brain/client"
import { sessionHref } from "@/utils/session-route"
import { getRelativeTime } from "@/utils/time"

/**
 * The Command Centre: its own threads (never Project threads), memory search, the link to Routines and a
 * composer that starts a fresh thread. A thread opens in the thread view, like a Project thread but without
 * review, files or terminal. `/command?thread=<session id>` (older links, the strip's "Open full") opens
 * that thread.
 */
export default function CommandCentrePage() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  const dialog = useDialog()
  // The provider outlives this page, so catch up on what changed while it was closed.
  onMount(() => void centre.refetch())
  const [search] = useSearchParams<{ thread?: string }>()
  const [state, setState] = createStore({ memory: "", query: "", hit: -1 })
  const open = (sessionID: string) => navigate(sessionHref(server.key, sessionID))
  createEffect(() => {
    if (search.thread) navigate(sessionHref(server.key, search.thread), { replace: true })
  })
  const [hits] = createResource(
    () => {
      const workspace = layout.home.workspace()
      return state.query && workspace ? { workspace, query: state.query } : undefined
    },
    (input) =>
      searchCommandMemory(
        { server: serverSDK().server, fetch: platform.fetch, target: { directory: input.workspace } },
        input.query,
      ).then(
        (items) => ({ items, failed: false }),
        () => ({ items: [], failed: true }),
      ),
  )

  // The pill starts on Settings › Command Centre's harness and model.
  const harness = createComposerHarness({
    scope: "command",
    directory: () => centre.directory() ?? "",
    initial: () => {
      const current = settings.commandCentre.current()
      return current.harnessID
        ? { harnessID: current.harnessID, model: current.modelID ? { id: current.modelID } : undefined }
        : undefined
    },
  })
  const composer = createComposerController({
    // Each request from here is a fresh thread; it opens once started. A failed send keeps the text.
    send: async (text) => {
      const id = await centre.send(text, null, {
        harnessID: harness.harnessID(),
        harnessModel: harness.harnessModel(),
        model: harness.builtInModel(),
      })
      if (!id) return false
      open(id)
      return true
    },
    disabled: () => !centre.directory(),
    blocked: () => centre.sending() || harness.waiting(),
  })

  return (
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-labelledby="command-centre-title">
      <div class={`flex min-h-0 flex-1 flex-col overflow-hidden ${pagePanelClass}`}>
        <PageHeader
          id="command-centre-title"
          title={language.t("secondBrain.commandCentre.title")}
          actions={
            <>
              <Show when={centre.directory()}>
                {(directory) => (
                  <ButtonV2
                    size="small"
                    variant="ghost"
                    onClick={() => dialog.show(() => <DialogArchivedThreads ctrl={ctrl} directory={directory()} />)}
                  >
                    {language.t("secondBrain.sidebar.archivedThreads")}
                  </ButtonV2>
                )}
              </Show>
              <A
                href="/routines"
                class="rounded-full px-3 py-1.5 text-[13px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
              >
                {language.t("secondBrain.routines.title")}
              </A>
            </>
          }
        />
        <div class="flex min-h-0 flex-1 gap-2 px-3 pb-3">
          <aside class="flex w-[260px] shrink-0 flex-col gap-2 overflow-y-auto">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                setState({ query: state.memory.trim(), hit: -1 })
              }}
            >
              <input
                type="search"
                class="h-8 w-full rounded-full border border-v2-border-border-muted bg-v2-background-bg-deep px-3 text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
                placeholder={language.t("secondBrain.commandCentre.memory.placeholder")}
                aria-label={language.t("secondBrain.commandCentre.memory.label")}
                value={state.memory}
                onInput={(event) => {
                  const memory = event.currentTarget.value
                  setState(memory.trim() ? { memory } : { memory, query: "", hit: -1 })
                }}
              />
            </form>
            <Show when={state.query}>
              <Show
                when={!hits.loading}
                fallback={
                  <p role="status" class="px-3 text-[12px] text-v2-text-text-faint">
                    {language.t("secondBrain.commandCentre.memory.searching")}
                  </p>
                }
              >
                <ul class="flex flex-col gap-1" aria-label={language.t("secondBrain.commandCentre.memory.results")}>
                  <For
                    each={hits()?.items ?? []}
                    fallback={
                      <li role={hits()?.failed ? "alert" : undefined} class="px-3 text-[12px] text-v2-text-text-faint">
                        {language.t(hits()?.failed ? "common.requestFailed" : "secondBrain.commandCentre.memory.empty")}
                      </li>
                    }
                  >
                    {(hit, index) => (
                      <li>
                        {/* A hit from a live thread opens it; a summary (its thread was compacted) expands in place. */}
                        <button
                          type="button"
                          class={`${pageRowClass} !py-1.5`}
                          aria-expanded={hit.sessionID ? undefined : state.hit === index()}
                          onClick={() => {
                            if (hit.sessionID) return open(hit.sessionID)
                            setState("hit", state.hit === index() ? -1 : index())
                          }}
                        >
                          <span
                            class="min-w-0 flex-1 whitespace-pre-wrap text-[12px] text-v2-text-text-muted"
                            classList={{ "line-clamp-2": state.hit !== index() }}
                          >
                            {hit.text}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
            <Show
              when={centre.threads().length > 0}
              fallback={
                <p role={centre.loading() ? "status" : undefined} class="px-3 py-2 text-[12px] text-v2-text-text-faint">
                  {centre.loading()
                    ? language.t("common.loading")
                    : language.t("secondBrain.commandCentre.threads.empty")}
                </p>
              }
            >
              <ul class="flex flex-col gap-0.5" aria-label={language.t("secondBrain.commandCentre.threads")}>
                <For each={centre.threads().filter((thread) => !ctrl.threadHidden(thread.id))}>
                  {(thread) => <ThreadRow thread={thread} href={sessionHref(server.key, thread.id)} />}
                </For>
              </ul>
            </Show>
          </aside>
          <div class="@container flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto rounded-[20px] bg-v2-background-bg-deep px-6 py-8">
            <PageEmpty title={language.t("secondBrain.commandCentre.empty.title")}>
              {language.t("secondBrain.commandCentre.empty.body")}
            </PageEmpty>
            <ComposerBox
              size="large"
              class="w-full max-w-[720px]"
              controller={composer}
              label={language.t("secondBrain.commandCentre.composer.label")}
              placeholder={language.t("secondBrain.commandCentre.composer.placeholder")}
              sendLabel={language.t("secondBrain.commandCentre.composer.send")}
              controls={<ComposerModelPill harness={harness} />}
            />
            <Show when={centre.error()}>
              <p role="alert" class="text-[12px] text-v2-text-text-critical">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </div>
        </div>
      </div>
    </section>
  )
}

/** A Command Centre thread: opens on click, with the sidebar's rename, archive and delete in a "…" menu. */
function ThreadRow(props: { thread: CommandThread; href: string }) {
  const language = useLanguage()
  const centre = useCommandCentre()
  const ctrl = useSidebarController()
  const [editing, setEditing] = createSignal(false)
  const label = () => centre.label(props.thread)
  let input: HTMLInputElement | undefined
  const finish = (value: string | undefined) => {
    if (!editing()) return
    setEditing(false)
    if (value !== undefined) void ctrl.renameThread(props.thread.session, value)
  }

  return (
    <li class="group/row relative">
      <Show
        when={!editing()}
        fallback={
          <input
            ref={input}
            class="h-9 w-full min-w-0 rounded-full bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
            value={label()}
            aria-label={language.t("secondBrain.sidebar.renameThread")}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") finish(event.currentTarget.value)
              if (event.key === "Escape") finish(undefined)
            }}
            onBlur={(event) => finish(event.currentTarget.value)}
          />
        }
      >
        <A href={props.href} class={pageRowClass}>
          <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">
            {label() || language.t("secondBrain.commandCentre.threads.untitled")}
          </span>
          <Show
            when={centre.working(props.thread.id)}
            fallback={
              <span class="shrink-0 text-[11px] text-v2-text-text-faint group-hover/row:opacity-0">
                {getRelativeTime(new Date(props.thread.updated).toISOString(), language.t)}
              </span>
            }
          >
            <span
              class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse group-hover/row:opacity-0"
              role="img"
              aria-label={language.t("secondBrain.commandCentre.working")}
            />
          </Show>
        </A>
        <div class="absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
          <MenuV2 gutter={4} modal={false} placement="bottom-start">
            <MenuV2.Trigger
              as={IconButtonV2}
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" size="small" />}
              aria-label={language.t("secondBrain.sidebar.threadActions")}
            />
            <MenuV2.Portal>
              <MenuV2.Content
                onCloseAutoFocus={() => {
                  // The menu returns focus to its trigger first, so the input takes it in a microtask.
                  if (editing()) queueMicrotask(() => input?.select())
                }}
              >
                <MenuV2.Item onSelect={() => setEditing(true)}>{language.t("common.rename")}</MenuV2.Item>
                <MenuV2.Item onSelect={() => void ctrl.archiveThread(props.thread.session)}>
                  {language.t("common.archive")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={() => ctrl.deleteThread(props.thread.session)}>
                  {language.t("common.delete")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </Show>
    </li>
  )
}
