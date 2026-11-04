import { useBeforeLeave } from "@solidjs/router"
import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { createEffect, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

function ChoiceDialog(props: { title: string; body: string; children: JSX.Element }) {
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(440px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2">
        <p class="text-[13px] text-v2-text-text-muted">{props.body}</p>
      </DialogBody>
      <DialogFooter>{props.children}</DialogFooter>
    </Dialog>
  )
}

function DialogUnsaved(props: {
  body: string
  /** Resolves false when the save failed; the form shows why and the page stays open. */
  onSave: () => Promise<boolean>
  onDiscard: () => void
  onLeave: () => void
  /** Also runs when another dialog replaces this one. */
  onClosed: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({ busy: false })
  onCleanup(props.onClosed)
  const save = () => {
    setState("busy", true)
    void props.onSave().then((saved) => {
      setState("busy", false)
      dialog.close()
      if (saved) props.onLeave()
    })
  }
  return (
    <ChoiceDialog title={language.t("secondBrain.unsaved.title")} body={props.body}>
      <ButtonV2 variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
        {language.t("secondBrain.unsaved.keep")}
      </ButtonV2>
      <ButtonV2
        variant="ghost"
        disabled={state.busy}
        onClick={() => {
          dialog.close()
          props.onDiscard()
          props.onLeave()
        }}
      >
        {language.t("secondBrain.notes.discard")}
      </ButtonV2>
      <ButtonV2 variant="contrast" disabled={state.busy} onClick={save}>
        {state.busy ? language.t("secondBrain.saving") : language.t("common.save")}
      </ButtonV2>
    </ChoiceDialog>
  )
}

/**
 * Guards a form with unsaved edits. Leaving inside the app asks Save / Discard / Keep editing and then finishes the
 * navigation; closing the window asks in the desktop shell, which also holds a quit before it stops the server.
 */
export function useUnsavedGuard(input: {
  dirty: () => boolean
  save: () => Promise<boolean>
  discard: () => void
  body: () => string
}) {
  const dialog = useDialog()
  const platform = usePlatform()
  let asking = false

  createEffect(() => platform.setUnsavedChanges?.(input.dirty()))
  onCleanup(() => platform.setUnsavedChanges?.(false))

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!input.dirty()) return
    event.preventDefault()
    event.returnValue = ""
  }
  window.addEventListener("beforeunload", beforeUnload)
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload))

  useBeforeLeave((event) => {
    if (!input.dirty()) return
    event.preventDefault()
    if (asking) return
    asking = true
    void dialog.show(() => (
      <DialogUnsaved
        body={input.body()}
        onSave={input.save}
        onDiscard={input.discard}
        // Forced: a saved form can still look dirty until its refreshed record arrives.
        onLeave={() => event.retry(true)}
        onClosed={() => (asking = false)}
      />
    ))
  })
}

/** Confirms replacing unsaved edits with the page on disk; a copy keeps them instead. */
export function DialogConfirmReload(props: { onReload: () => void; onCopy: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const choose = (action: () => void) => {
    dialog.close()
    action()
  }
  return (
    <ChoiceDialog
      title={language.t("secondBrain.vault.reload.title")}
      body={language.t("secondBrain.vault.reload.body")}
    >
      <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
        {language.t("common.cancel")}
      </ButtonV2>
      <ButtonV2 variant="ghost" onClick={() => choose(props.onCopy)}>
        {language.t("secondBrain.vault.saveCopy")}
      </ButtonV2>
      <ButtonV2 variant="danger" onClick={() => choose(props.onReload)}>
        {language.t("secondBrain.notes.reload")}
      </ButtonV2>
    </ChoiceDialog>
  )
}
