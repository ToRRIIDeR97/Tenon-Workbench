import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { createEffect, createSignal, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { approveFolder, type FolderTrust, readFolderTrust } from "@/features/second-brain/client"
import { showToast } from "@/utils/toast"

type Client = Parameters<typeof approveFolder>[0]
type Language = ReturnType<typeof useLanguage>

// Folders asked about this run. "Not now" leaves the folder as it is until the next launch.
const asked = new Set<string>()

const withheldLabel = (language: Language, key: string) => {
  const labels: Record<string, Parameters<Language["t"]>[0]> = {
    mcp: "folderTrust.withheld.mcp",
    plugin: "folderTrust.withheld.plugin",
    tools: "folderTrust.withheld.tools",
    skills: "folderTrust.withheld.skills",
    provider: "folderTrust.withheld.provider",
    lsp: "folderTrust.withheld.lsp",
    formatter: "folderTrust.withheld.formatter",
    shell: "folderTrust.withheld.shell",
    references: "folderTrust.withheld.references",
    reference: "folderTrust.withheld.references",
    instructions: "folderTrust.withheld.instructions",
    variables: "folderTrust.withheld.variables",
  }
  return labels[key] ? language.t(labels[key]) : key
}

function DialogFolderTrust(props: { client: Client; trust: FolderTrust }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)
  const withheld = () => [...new Set(props.trust.withheld.map((key) => withheldLabel(language, key)))]

  const approve = async () => {
    setBusy(true)
    await approveFolder(props.client)
      .then(() => dialog.close())
      .catch(() => showToast({ title: language.t("common.requestFailed") }))
    setBusy(false)
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("folderTrust.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-full min-w-0 flex-col gap-3 px-4 pt-2 pb-2">
        <code class="min-w-0 break-all">{props.trust.root}</code>
        <p>{language.t("folderTrust.description")}</p>
        <ul class="list-disc pl-5">
          <For each={withheld()}>{(label) => <li>{label}</li>}</For>
        </ul>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("folderTrust.notNow")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy()} onClick={approve}>
          {language.t("folderTrust.approve")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Asks once per run when an unapproved folder's config wants something that stays off. Opening a
 * folder, by deep link or otherwise, never approves it: only the button here does.
 */
export function FolderTrustPrompt(props: { directory: string }) {
  const dialog = useDialog()
  const platform = usePlatform()
  const serverSDK = useServerSDK()

  createEffect(() => {
    const server = serverSDK().server
    const client = { server, fetch: platform.fetch, target: { directory: props.directory } }
    void readFolderTrust(client)
      .then((trust) => {
        const key = `${server.http.url}\0${trust.root}`
        if (trust.trusted || !trust.withheld.length || asked.has(key)) return
        asked.add(key)
        void dialog.show(() => <DialogFolderTrust client={client} trust={trust} />)
      })
      // An older server has no trust route, and a failed check leaves the folder unapproved.
      .catch(() => undefined)
  })

  return null
}
