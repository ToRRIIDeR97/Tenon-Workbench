import { For, Show, createEffect, on, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@tenon/ui/popover"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { Switch } from "@tenon/ui/v2/switch-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { getFilename } from "@tenon/core/util/path"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { listBranches, switchBranch } from "@/utils/server"
import { showToast } from "@/utils/toast"

/** Worktree on/off. On creates a git worktree for the thread; an existing one picked elsewhere also reads as on. */
export function PromptWorktreeSwitch(props: {
  value: string
  projectRoot: string
  onChange: (value: string) => void
  onDone: () => void
}) {
  const language = useLanguage()
  const on = () => props.value !== props.projectRoot && props.value !== "main"
  const label = () =>
    on() && props.value !== "create" ? getFilename(props.value) : language.t("secondBrain.composer.worktree")

  return (
    <TooltipV2 placement="top" value={language.t("secondBrain.composer.worktree.description")}>
      <Switch
        size="small"
        checked={on()}
        class="flex h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-full px-2.5 text-[13px] [&_[data-slot=switch-label]]:truncate"
        onChange={(checked: boolean) => {
          props.onChange(checked ? "create" : "main")
          props.onDone()
        }}
      >
        {label()}
      </Switch>
    </TooltipV2>
  )
}

/** The folder's current branch, or that the folder isn't a git repository. */
export function PromptGitStatus(props: { branch?: string; noGit?: boolean }) {
  const language = useLanguage()
  const label = () => {
    if (props.noGit) return language.t("session.new.git.none")
    return props.branch
  }

  return (
    <Show when={label()}>
      {(value) => (
        <TooltipV2
          placement="top"
          value={value()}
          class="min-w-0 max-w-[220px]"
          contentClass="max-w-[calc(100vw-32px)] break-all"
        >
          <div class="flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 px-3 type-control text-v2-text-text-muted">
            <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 truncate">{value()}</span>
          </div>
        </TooltipV2>
      )}
    </Show>
  )
}

// Each folder's last branch list, so a picker opened again (or in another composer) shows it at once.
const knownBranches = new Map<string, string[]>()

/**
 * The folder's branch as a picker: opening it lists the local branches, and choosing one switches the folder to it.
 * Git refuses a switch that would lose local changes; its reason shows as a toast. With no branches the list is
 * empty, and a folder outside git shows that instead of a picker.
 */
export function PromptBranchPicker(props: { directory: string; branch?: string; noGit?: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore<{
    open: boolean
    branches?: string[]
    failed: boolean
    switching?: string
  }>({ open: false, branches: knownBranches.get(props.directory), failed: false })
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  // Fetched as soon as the picker shows and again on each open; the last list stays up meanwhile, so opening never
  // flashes a loading row and the rows update in place when the answer differs.
  const load = () => {
    const directory = props.directory
    listBranches(server(), directory).then(
      (branches) => {
        knownBranches.set(directory, branches)
        if (directory === props.directory) setState({ branches, failed: false })
      },
      () => {
        if (directory === props.directory && !state.branches) setState({ branches: [], failed: true })
      },
    )
  }
  onMount(() => !props.noGit && load())
  createEffect(
    on(
      () => props.directory,
      (directory) => {
        setState({ branches: knownBranches.get(directory), failed: false })
        if (!props.noGit) load()
      },
      { defer: true },
    ),
  )
  const choose = (branch: string) => {
    if (branch === props.branch || state.switching) return
    setState("switching", branch)
    switchBranch(server(), props.directory, branch).then(
      () => setState({ open: false, switching: undefined }),
      (error: unknown) => {
        setState("switching", undefined)
        showToast({
          variant: "error",
          title: language.t("secondBrain.composer.branch.failed", { branch }),
          description: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  const picker = (
    <Show when={!props.noGit} fallback={<PromptGitStatus noGit />}>
      <Popover
        open={state.open}
        onOpenChange={(next) => {
          setState("open", next)
          if (next) load()
        }}
        placement="bottom-start"
        gutter={6}
        class="w-[min(280px,calc(100vw-32px))] [&_[data-slot=popover-body]]:p-1.5"
        triggerAs="button"
        triggerProps={{
          type: "button",
          class:
            "flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 rounded-full px-3 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base active:bg-v2-overlay-simple-overlay-pressed data-[expanded]:bg-v2-overlay-simple-overlay-hover data-[expanded]:text-v2-text-text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none",
        }}
        trigger={
          <>
            <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 truncate">{props.branch ?? language.t("secondBrain.composer.branch.detached")}</span>
            <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          </>
        }
      >
        <div data-component="prompt-branch-picker" class="flex flex-col text-[13px]">
          <div class="px-2.5 pb-1 pt-2 text-[12px] leading-4 font-[500] text-v2-text-text-muted">
            {language.t("secondBrain.composer.branch.title")}
          </div>
          <Show when={state.branches}>
            {(branches) => (
              <div class="flex max-h-72 min-w-0 flex-col overflow-y-auto">
                <For
                  each={branches()}
                  fallback={
                    <p class="px-2.5 py-2 text-[12px] leading-4 text-v2-text-text-muted">
                      {language.t(
                        state.failed ? "secondBrain.composer.branch.error" : "secondBrain.composer.branch.none",
                      )}
                    </p>
                  }
                >
                  {(branch) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={branch === props.branch}
                      class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                      onClick={() => choose(branch)}
                    >
                      <span class="min-w-0 flex-1 truncate font-mono text-[12px]">{branch}</span>
                      <Show when={state.switching === branch}>
                        <LoaderV2 width={12} height={12} class="shrink-0 text-v2-icon-icon-accent" />
                      </Show>
                      <Show when={branch === props.branch}>
                        <Icon name="check" size="small" class="shrink-0 text-v2-text-text-accent" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </Popover>
    </Show>
  )

  return (
    <TooltipV2
      placement="top"
      class="min-w-0"
      inactive={props.noGit}
      value={language.t("secondBrain.composer.branch.title")}
    >
      {picker}
    </TooltipV2>
  )
}
