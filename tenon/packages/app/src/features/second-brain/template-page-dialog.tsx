import { useDialog } from "@tenon/ui/context/dialog"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@tenon/ui/v2/dialog-v2"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"

export function DialogTemplatePage(props: { template: string; onCreate: (title: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [title, setTitle] = createSignal("")
  const submit = () => {
    const name = title().trim()
    if (!name) return
    dialog.close()
    props.onCreate(name)
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.templates.nameTitle", { template: props.template })}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(440px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2">
        <form
          class="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label class="flex flex-col gap-1.5 text-[13px] text-v2-text-text-base">
            {language.t("secondBrain.templates.nameLabel")}
            <input
              ref={(element: HTMLInputElement) => element.setAttribute("autofocus", "")}
              placeholder={props.template}
              class="h-9 rounded-[12px] bg-v2-background-bg-layer-01 px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
              value={title()}
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
        </form>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!title().trim()} onClick={submit}>
          {language.t("secondBrain.templates.nameConfirm")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
