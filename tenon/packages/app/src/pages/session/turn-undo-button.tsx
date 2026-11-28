import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useAgentWrites, type AgentWrite } from "@/features/agent-writes/store"
import { showToast } from "@/utils/toast"
import { revertFiles } from "./file-write"
import { folderPrefix, turnUndoPlan, turnUndoSummary, type TurnDiff, type TurnUndoPlan } from "./turn-undo"

export function TurnUndoButton(props: {
  directory: string
  worktree?: string
  diffs: ReadonlyArray<TurnDiff>
  writes: ReadonlyArray<AgentWrite>
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const plan = createMemo(() =>
    turnUndoPlan({ diffs: props.diffs, writes: props.writes, prefix: folderPrefix(props.worktree, props.directory) }),
  )
  const [undone, setUndone] = createSignal(false)
  return (
    <Show when={!plan().empty && !undone()}>
      <div class="flex justify-end pt-1" data-component="turn-undo">
        <ButtonV2
          size="small"
          variant="ghost-muted"
          icon="arrow-undo-down"
          onClick={() =>
            void dialog.show(() => (
              <DialogTurnUndo
                directory={props.directory}
                plan={plan()}
                writes={props.writes}
                onDone={() => setUndone(true)}
              />
            ))
          }
        >
          {language.t("secondBrain.turnUndo.button")}
        </ButtonV2>
      </div>
    </Show>
  )
}

function DialogTurnUndo(props: {
  directory: string
  plan: TurnUndoPlan
  writes: ReadonlyArray<AgentWrite>
  onDone: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const agentWrites = useAgentWrites()
  const [busy, setBusy] = createSignal(false)
  const writes = () => props.writes.filter((write) => props.plan.writes.includes(write.id))

  const run = async () => {
    if (busy()) return
    setBusy(true)
    const files = props.plan.files.length
      ? await revertFiles({
          server: serverSDK().server,
          fetch: platform.fetch,
          directory: props.directory,
          files: props.plan.files,
        })
      : []
    const states = await Promise.all(props.plan.writes.map((id) => agentWrites?.undo(id) ?? Promise.resolve(undefined)))
    setBusy(false)
    dialog.close()
    const summary = turnUndoSummary(
      files,
      states.map((state) => state ?? "failed"),
    )
    if (summary.reverted > 0 && summary.failed === 0) props.onDone()
    showToast({
      variant: summary.failed > 0 ? "error" : undefined,
      title: language.t("secondBrain.turnUndo.done", { count: summary.reverted }),
      description:
        summary.changed + summary.failed > 0
          ? language.t("secondBrain.turnUndo.kept", { changed: summary.changed, failed: summary.failed })
          : undefined,
    })
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.turnUndo.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(520px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2 text-[13px]">
        <p class="text-v2-text-text-muted">{language.t("secondBrain.turnUndo.body")}</p>
        <Show when={props.plan.files.length > 0}>
          <ul class="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0 font-mono text-[12px]">
            <For each={props.plan.files}>
              {(file) => (
                <li class="flex gap-2">
                  <span class="text-v2-text-text-muted">
                    {language.t(`secondBrain.turnUndo.status.${file.status}`)}
                  </span>
                  <span class="truncate">{file.file}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={writes().length > 0}>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            <For each={writes()}>{(write) => <li class="truncate">{write.target}</li>}</For>
          </ul>
        </Show>
        <Show when={props.plan.skipped.length > 0}>
          <p class="type-meta text-v2-text-text-muted">
            {language.t("secondBrain.turnUndo.skipped", { count: props.plan.skipped.length })}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" disabled={busy()} onClick={() => void run()}>
          {language.t("secondBrain.turnUndo.confirm")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
