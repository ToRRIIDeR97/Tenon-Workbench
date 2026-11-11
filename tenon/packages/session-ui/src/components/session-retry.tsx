import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { useI18n } from "@tenon/ui/context/i18n"
import { Card } from "@tenon/ui/card"
import { Reveal } from "@tenon/ui/v2/reveal"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"

export function SessionRetry(props: { status: SessionStatus; show?: boolean }) {
  const i18n = useI18n()
  const live = createMemo(() => {
    if (props.status.type !== "retry") return
    return props.status
  })
  // Keeps the last retry so the card keeps its text while it collapses.
  const retry = createMemo<Extract<SessionStatus, { type: "retry" }> | undefined>((last) => live() ?? last)
  const [seconds, setSeconds] = createSignal(0)
  createEffect(
    on(live, (current) => {
      if (!current) return
      const update = () => {
        const next = retry()?.next
        if (!next) return
        setSeconds(Math.round((next - Date.now()) / 1000))
      }
      update()
      const timer = setInterval(update, 1000)
      onCleanup(() => clearInterval(timer))
    }),
  )
  const message = createMemo(() => {
    const current = retry()
    if (!current) return ""
    if (current.message.includes("exceeded your current quota") && current.message.includes("gemini")) {
      return i18n.t("ui.sessionTurn.retry.geminiHot")
    }
    if (current.message.length > 80) return current.message.slice(0, 80) + "..."
    return current.message
  })
  const truncated = createMemo(() => {
    const current = retry()
    if (!current) return false
    return current.message.length > 80
  })
  const info = createMemo(() => {
    const current = retry()
    if (!current) return ""
    const count = Math.max(0, seconds())
    const delay = count > 0 ? i18n.t("ui.sessionTurn.retry.inSeconds", { seconds: count }) : ""
    const retrying = i18n.t("ui.sessionTurn.retry.retrying")
    const line = [retrying, delay].filter(Boolean).join(" ")
    if (!line) return i18n.t("ui.sessionTurn.retry.attempt", { attempt: current.attempt })
    return i18n.t("ui.sessionTurn.retry.attemptLine", { line, attempt: current.attempt })
  })

  return (
    <Reveal open={!!live() && (props.show ?? true)} variant="line">
      <div data-slot="session-turn-retry">
        <Card variant="error" class="error-card">
          <div class="flex items-start gap-2">
            <LoaderV2 class="size-4 mt-0.5" style={{ color: "inherit" }} />
            <div class="min-w-0">
              <Show when={truncated()} fallback={<div data-slot="session-turn-retry-message">{message()}</div>}>
                <TooltipV2 value={retry()?.message ?? ""} placement="top" contentClass="max-w-[320px] break-words">
                  <div data-slot="session-turn-retry-message" class="cursor-help truncate">
                    {message()}
                  </div>
                </TooltipV2>
              </Show>
              <Show when={info()}>{(line) => <div data-slot="session-turn-retry-info">{line()}</div>}</Show>
            </div>
          </div>
        </Card>
      </div>
    </Reveal>
  )
}
