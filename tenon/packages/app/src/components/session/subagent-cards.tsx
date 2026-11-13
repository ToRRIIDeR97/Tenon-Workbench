import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Reveal } from "@tenon/ui/v2/reveal"
import { For, Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { subagentBar, type SubagentContext } from "./subagent-context"

export type SubagentCardRow = SubagentContext & { title: string; agent?: string }

/**
 * The Context tab's Subagents: one card per subagent with its own context (tokens used of its window), its agent,
 * turn and how it ended. Selecting a card opens what it used, with Open in Agents and Show in thread.
 */
export function SubagentCards(props: {
  rows: readonly SubagentCardRow[]
  /** Opens the subagent in the side panel's Agents tab, where the layout has one. */
  onOpen?: (row: SubagentCardRow) => void
  onReveal: (turnID: string) => void
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal<string>()
  const compact = (value: number) =>
    new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }).format(value)
  const done = () => props.rows.filter((row) => row.status === "completed").length
  const ended = (row: SubagentCardRow) => {
    if (row.status === "running" || row.status === "pending") return language.t("secondBrain.subagentCards.running")
    if (row.status === "error") return language.t("secondBrain.subagentCards.failed")
    return row.seconds === undefined
      ? language.t("secondBrain.subagentCards.done")
      : language.t("secondBrain.subagentCards.doneIn", { seconds: row.seconds })
  }
  const usageRows = (row: SubagentCardRow) =>
    (
      [
        ["secondBrain.subagentCards.input", row.usage.input],
        ["secondBrain.subagentCards.cacheRead", row.usage.cacheRead],
        ["secondBrain.subagentCards.output", row.usage.output],
        ["secondBrain.subagentCards.reasoning", row.usage.reasoning],
      ] as const
    ).filter((entry): entry is readonly [(typeof entry)[0], number] => entry[1] !== undefined && entry[1] > 0)

  return (
    <section data-slot="session-tab-subagent-cards" class="flex flex-col gap-2">
      <div class="flex items-baseline gap-2">
        <h3 class="m-0 flex-1 text-[13px] leading-[18px] [font-weight:600] text-v2-text-text-base">
          {language.t("secondBrain.sessionTab.subagents")}
        </h3>
        <span class="text-[12px] text-v2-text-text-muted">
          {language.t("secondBrain.subagentCards.summary", { done: done(), all: props.rows.length })}
        </span>
      </div>
      <For each={props.rows}>
        {(row) => {
          const selected = () => open() === row.id
          return (
            <div
              data-slot="session-tab-subagent-card"
              data-status={row.status}
              class="flex w-full min-w-0 flex-col rounded-[14px] bg-v2-background-bg-layer-01 transition-[background-color,box-shadow] duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none"
              classList={{ "shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]": selected() }}
            >
              <button
                type="button"
                aria-expanded={selected()}
                class="flex w-full min-w-0 flex-col gap-1.5 rounded-[14px] px-3 py-2.5 text-left outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
                onClick={() => setOpen(selected() ? undefined : row.id)}
              >
                <span class="flex min-w-0 items-baseline gap-2 text-[12.5px] leading-[18px]">
                  <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{row.title}</span>
                  <Show
                    when={row.context}
                    fallback={
                      <Show
                        when={row.estimate}
                        fallback={
                          <Show when={row.usage.input !== undefined}>
                            <span class="shrink-0 tabular-nums text-v2-text-text-base">
                              {compact((row.usage.input ?? 0) + (row.usage.cacheRead ?? 0))}
                            </span>
                          </Show>
                        }
                      >
                        {(estimate) => (
                          <>
                            <span class="shrink-0 tabular-nums text-v2-text-text-base">{`≈${compact(estimate())}`}</span>
                            <span class="shrink-0 text-[12px] text-v2-text-text-muted">
                              {language.t("secondBrain.sessionTab.estimated")}
                            </span>
                          </>
                        )}
                      </Show>
                    }
                  >
                    {(context) => (
                      <>
                        <span class="shrink-0 tabular-nums text-v2-text-text-base">{compact(context().used)}</span>
                        <Show when={context().size}>
                          {(size) => (
                            <span class="shrink-0 text-[12px] tabular-nums text-v2-text-text-muted">
                              {`/ ${compact(size())} · ${context().percent ?? 0}%`}
                            </span>
                          )}
                        </Show>
                      </>
                    )}
                  </Show>
                </span>
                <span
                  class="block h-[5px] overflow-hidden rounded-full bg-v2-background-bg-layer-03"
                  aria-hidden="true"
                >
                  <span
                    class="block h-full rounded-full bg-v2-icon-icon-accent/55 transition-[width] duration-long ease-emphasized-decelerate motion-reduce:transition-none"
                    style={{ width: `${subagentBar(row, props.rows)}%` }}
                  />
                </span>
                <span class="text-[11.5px] leading-4 text-v2-text-text-muted">
                  {[
                    row.agent,
                    language.t("secondBrain.sessionTab.turn", { turn: row.turn }),
                    ended(row),
                    row.usage.output
                      ? language.t("secondBrain.subagentCards.back", { tokens: compact(row.usage.output) })
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              <Reveal open={selected()}>
                <div class="flex flex-col gap-2 px-3 pb-3">
                  <Show
                    when={usageRows(row).length > 0}
                    fallback={
                      <p class="m-0 text-[12px] leading-4 text-v2-text-text-muted">
                        {row.estimate
                          ? language.t("secondBrain.subagentCards.estimateNote", { tokens: compact(row.estimate) })
                          : language.t("secondBrain.subagentCards.noUsage")}
                      </p>
                    }
                  >
                    <dl class="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12px] leading-4 tabular-nums">
                      <For each={usageRows(row)}>
                        {([label, value]) => (
                          <>
                            <dt class="text-v2-text-text-base">{language.t(label)}</dt>
                            <dd class="m-0 text-v2-text-text-muted">{value.toLocaleString(language.intl())}</dd>
                          </>
                        )}
                      </For>
                    </dl>
                  </Show>
                  <div class="flex flex-wrap gap-2 pt-0.5">
                    <Show when={props.onOpen}>
                      {(openRow) => (
                        <ButtonV2 size="small" variant="neutral" onClick={() => openRow()(row)}>
                          {language.t("secondBrain.subagentCards.openInAgents")}
                        </ButtonV2>
                      )}
                    </Show>
                    <ButtonV2 size="small" variant="ghost" onClick={() => props.onReveal(row.turnID)}>
                      {language.t("secondBrain.subagentCards.showInThread")}
                    </ButtonV2>
                  </div>
                </div>
              </Reveal>
            </div>
          )
        }}
      </For>
      <p class="m-0 px-1 text-[12px] leading-4 text-v2-text-text-muted">
        {language.t("secondBrain.subagentCards.hint")}
      </p>
    </section>
  )
}
