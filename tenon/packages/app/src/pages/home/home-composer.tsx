import { useNavigate } from "@solidjs/router"
import { Icon } from "@tenon/ui/v2/icon"
import { createEffect, createMemo, createSignal, Show, Suspense, untrack } from "solid-js"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { PromptBranchPicker } from "@/components/prompt-workspace-selector"
import { PromptProjectSelector, createPromptProjectController } from "@/components/prompt-project-selector"
import { useProjectThreads } from "@/components/sidebar/sidebar-controller"
import { CommentsProvider } from "@/context/comments"
import { useDrafts } from "@/context/drafts"
import { FileProvider } from "@/context/file"
import { useLanguage } from "@/context/language"
import { ModelsProvider } from "@/context/models"
import { PromptProvider, usePrompt } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import type { Harness } from "@tenon/schema/harness"
import { createNewSessionDraftController } from "@/pages/new-session/new-session-draft-controller"
import { Greeting } from "@/pages/new-session/greeting"
import { DirectoryDataProvider } from "@/pages/directory-layout"

export function HomeComposer(props: { directory: string }) {
  const server = useServer()
  return (
    <Show when={props.directory} keyed>
      {(directory) => (
        <ModelsProvider directory={() => directory}>
          <SDKProvider directory={directory}>
            <DirectoryDataProvider directory={directory} server={() => server.key}>
              <FileProvider>
                <PromptProvider>
                  <CommentsProvider>
                    <Suspense fallback={<HomeComposerPlaceholder />}>
                      <HomeComposerBody directory={directory} />
                    </Suspense>
                  </CommentsProvider>
                </PromptProvider>
              </FileProvider>
            </DirectoryDataProvider>
          </SDKProvider>
        </ModelsProvider>
      )}
    </Show>
  )
}

function HomeComposerPlaceholder() {
  return (
    <>
      <Greeting />
      <div class="min-h-32 w-full rounded-[28px] bg-v2-background-bg-layer-01" aria-hidden="true" />
    </>
  )
}

function HomeComposerBody(props: { directory: string }) {
  const language = useLanguage()
  const settings = useSettings()
  const drafts = useDrafts()
  const navigate = useNavigate()
  const server = useServer()
  const serverSync = useServerSync()
  const prompt = usePrompt()
  const draft = createNewSessionDraftController({ worktree: () => "main", resetWorktree: () => {} })

  let started = false
  createEffect(() => {
    if (started || !prompt.ready() || !settings.ready()) return
    started = true
    untrack(() => {
      const choice = settings.harnesses.newThreadChoice()
      if (!choice) return
      prompt.harness.set(choice.harnessID as Harness.InstanceID)
      prompt.harness.model.set(choice.model as Harness.ModelSelection | undefined)
    })
  })

  const text = () =>
    prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
  const [composing, setComposing] = createSignal(false)

  const projectThreads = useProjectThreads()
  const projects = createMemo(() =>
    (projectThreads.isSuccess && Array.isArray(projectThreads.data) ? projectThreads.data : [])
      .filter((entry) => entry.project.status === "active")
      .toSorted((a, b) => a.project.name.localeCompare(b.project.name)),
  )
  const picker = createPromptProjectController({
    controls: () => ({
      available: [
        { worktree: props.directory, name: language.t("secondBrain.sidebar.workspaceThreads") },
        ...projects().map((entry) => ({
          worktree: entry.threadDirectory,
          name: entry.project.name,
          id: entry.project.id,
          lastActive: entry.lastActivityAt,
        })),
      ],
      directory: props.directory,
      select: (worktree, _server, projectID) =>
        void drafts.create(
          { server: server.key, directory: worktree, projectID },
          text(),
          undefined,
          draft.harness.current(),
          { harnessModel: draft.harness.model.current() },
        ),
      add: () => navigate("/projects"),
    }),
    onDone: draft.input.restoreFocus,
  })

  return (
    <div class="contents" onFocusIn={() => setComposing(true)} onFocusOut={() => setComposing(false)}>
      <Greeting swap={{ paused: () => composing() || !!text().trim() }} />
      <PromptInputV2Composer
        controller={draft.input}
        harness={draft.harness}
        boxHeader={
          <>
            <PromptProjectSelector controller={picker} placement="bottom-start" />
            <Icon name="chevron-down" size="small" class="shrink-0 -rotate-90 text-v2-icon-icon-muted" />
            <PromptBranchPicker
              directory={props.directory}
              branch={serverSync().child(props.directory)[0].vcs?.branch}
            />
          </>
        }
      />
    </div>
  )
}
