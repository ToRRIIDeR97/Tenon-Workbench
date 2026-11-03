import { A, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Markdown } from "@tenon/session-ui/markdown"
import { TextShimmer } from "@tenon/ui/text-shimmer"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageHeader, pagePanelClass, pageRowClass } from "@/components/page"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { AgentWriteSteps } from "@/features/agent-writes/cards"
import { useAgentWrites } from "@/features/agent-writes/store"
import { useCommandCentre } from "@/features/command-centre/command-centre"
import { searchCommandMemory } from "@/features/second-brain/client"
import { getRelativeTime } from "@/utils/time"

/**
 * The Command Centre: its own threads (never Project threads), the open thread with a composer, memory
 * search and the link to Routines. URL contract: `/command`, `/command?thread=<session id>`. A message sent
 * with no thread open starts a new thread; only an open thread is continued.
 */
export default function CommandCentrePage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const centre = useCommandCentre()
  const [search, setSearch] = useSearchParams<{ thread?: string }>()
  const [state, setState] = createStore({ input: "", fresh: false, memory: "", query: "", hit: -1 })
  const selected = createMemo(() => (state.fresh ? undefined : search.thread))
  createEffect(() => {
    const id = selected()
    if (id) centre.sync(id)
  })
  // The server titles a thread after its first reply; reload the list when the reply finishes.
  createEffect(
    on(
      () => centre.working(selected()),
      (working, before) => {
        if (before && !working) void centre.refetch()
      },
    ),
  )
  // The open thread's writes show in its step list here, so the top pill leaves them out.
  const agentWrites = useAgentWrites()
  createEffect(() => agentWrites?.focus(selected()))
  onCleanup(() => agentWrites?.focus(undefined))
  const [hits] = createResource(
    () => {
      const workspace = layout.home.workspace()
      return state.query && workspace ? { workspace, query: state.query } : undefined
    },
    (input) =>
      searchCommandMemory(
        { server: serverSDK().server, fetch: platform.fetch, target: { directory: input.workspace } },
        input.query,
      ).catch(() => []),
  )

  const submit = async () => {
    const text = state.input.trim()
    if (!text || centre.sending()) return
    const id = await centre.send(text, selected() ?? null)
    // A failed send keeps the text so it can be sent again.
    if (!id) return
    setState({ input: "", fresh: false })
    setSearch({ thread: id })
  }

  return (
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-labelledby="command-centre-title">
      <div class={`flex min-h-0 flex-1 flex-col overflow-hidden ${pagePanelClass}`}>
        <PageHeader
          id="command-centre-title"
          title={language.t("secondBrain.commandCentre.title")}
          actions={
            <>
              <A
                href="/routines"
                class="rounded-full px-3 py-1.5 text-[13px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base motion-reduce:transition-none"
              >
                {language.t("secondBrain.routines.title")}
              </A>
              <ButtonV2 size="small" variant="tonal" onClick={() => setState("fresh", true)}>
                {language.t("secondBrain.commandCentre.newThread")}
              </ButtonV2>
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
                onInput={(event) => setState("memory", event.currentTarget.value)}
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
                    each={hits() ?? []}
                    fallback={
                      <li class="px-3 text-[12px] text-v2-text-text-faint">
                        {language.t("secondBrain.commandCentre.memory.empty")}
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
                            if (hit.sessionID) {
                              setState("fresh", false)
                              setSearch({ thread: hit.sessionID })
                              return
                            }
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
                <For each={centre.threads()}>
                  {(thread) => (
                    <li>
                      <button
                        type="button"
                        class={pageRowClass}
                        aria-current={thread.id === selected() ? "true" : undefined}
                        classList={{ "bg-v2-background-bg-accent-container": thread.id === selected() }}
                        onClick={() => {
                          setState("fresh", false)
                          setSearch({ thread: thread.id })
                        }}
                      >
                        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">
                          {centre.label(thread) || language.t("secondBrain.commandCentre.threads.untitled")}
                        </span>
                        <Show
                          when={centre.working(thread.id)}
                          fallback={
                            <span class="shrink-0 text-[11px] text-v2-text-text-faint">
                              {getRelativeTime(new Date(thread.updated).toISOString(), language.t)}
                            </span>
                          }
                        >
                          <span
                            class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
                            role="img"
                            aria-label={language.t("secondBrain.commandCentre.working")}
                          />
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>
          <div class="flex min-h-0 min-w-0 flex-1 flex-col rounded-[20px] bg-v2-background-bg-deep">
            <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <Show
                when={selected() && centre.messages(selected()).length > 0}
                fallback={
                  <Show
                    when={!selected() && !centre.loading()}
                    fallback={<PageEmpty loading title={language.t("secondBrain.commandCentre.thread.loading")} />}
                  >
                    <PageEmpty title={language.t("secondBrain.commandCentre.empty.title")}>
                      {language.t("secondBrain.commandCentre.empty.body")}
                    </PageEmpty>
                  </Show>
                }
              >
                <ol class="mx-auto flex max-w-[760px] flex-col gap-4">
                  <For each={centre.messages(selected())}>
                    {(message) => (
                      <li
                        classList={{
                          "self-end rounded-[16px] bg-v2-background-bg-base px-4 py-2 text-[13px]":
                            message.role === "user",
                          "text-[13px]": message.role === "assistant",
                        }}
                      >
                        <Show when={message.role === "assistant"} fallback={message.text}>
                          <Markdown text={message.text} />
                        </Show>
                      </li>
                    )}
                  </For>
                  {/* The agent's in-progress state until its reply completes; streamed text shows above. */}
                  <Show when={centre.working(selected())}>
                    <li role="status" class="animate-enter text-[13px]">
                      <TextShimmer text={language.t("secondBrain.commandCentre.working")} />
                    </li>
                  </Show>
                </ol>
              </Show>
              {/* AC-7.7: the writes of the open thread's current turn as one step list. */}
              <Show when={centre.writes(selected()).length > 0}>
                <div class="mx-auto mt-4 max-w-[760px]">
                  <AgentWriteSteps writes={centre.writes(selected())} />
                </div>
              </Show>
            </div>
            <form
              class="flex shrink-0 items-center gap-2 px-4 pb-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <input
                type="text"
                class="h-10 min-w-0 flex-1 rounded-full border border-v2-border-border-muted bg-v2-background-bg-base px-4 text-[13px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
                placeholder={language.t("secondBrain.commandCentre.composer.placeholder")}
                aria-label={language.t("secondBrain.commandCentre.composer.label")}
                value={state.input}
                disabled={!centre.directory()}
                onInput={(event) => setState("input", event.currentTarget.value)}
              />
              <ButtonV2
                variant="contrast"
                type="submit"
                disabled={!state.input.trim() || centre.sending() || !centre.directory()}
              >
                {language.t("secondBrain.commandCentre.composer.send")}
              </ButtonV2>
            </form>
            <Show when={centre.error()}>
              <p role="alert" class="px-5 pb-3 text-[12px] text-v2-text-text-critical">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </div>
        </div>
      </div>
    </section>
  )
}
