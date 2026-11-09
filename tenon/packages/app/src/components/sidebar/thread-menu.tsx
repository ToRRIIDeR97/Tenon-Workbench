import { MenuV2 } from "@tenon/ui/v2/menu-v2"
import { formatKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import { THREAD_MENU_KEYS, threadMenuAction, type ThreadMenuAction } from "./thread-menu-keys"

export type ThreadMenuRun = Record<ThreadMenuAction, () => void>

/**
 * Runs the item whose single key was pressed while the thread menu has focus, then closes the menu:
 * the same order as a click. Pass it to `MenuV2.Content`'s `onKeyDown`.
 */
export function onThreadMenuKey(event: KeyboardEvent, run: ThreadMenuRun, close: () => void) {
  const action = threadMenuAction(event)
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  run[action]()
  close()
}

/** A thread's menu items, in one order for the sidebar row and the thread header. */
export function ThreadMenuItems(props: { run: ThreadMenuRun; pinned: boolean }) {
  const language = useLanguage()
  const hint = (action: keyof typeof THREAD_MENU_KEYS) => formatKeybind(THREAD_MENU_KEYS[action], language.t)
  return (
    <>
      <MenuV2.Item onSelect={props.run.rename} shortcut={hint("rename")}>
        {language.t("common.rename")}
      </MenuV2.Item>
      <MenuV2.Item onSelect={props.run.pin} shortcut={hint("pin")}>
        {language.t(props.pinned ? "secondBrain.sidebar.unpin" : "secondBrain.sidebar.pin")}
      </MenuV2.Item>
      <MenuV2.Item onSelect={props.run.fork} shortcut={hint("fork")}>
        {language.t("secondBrain.sidebar.fork")}
      </MenuV2.Item>
      <MenuV2.Item onSelect={props.run.export}>{language.t("common.export")}</MenuV2.Item>
      <MenuV2.Separator />
      <MenuV2.Item onSelect={props.run.archive} shortcut={hint("archive")}>
        {language.t("common.archive")}
      </MenuV2.Item>
      <MenuV2.Item critical onSelect={props.run.delete} shortcut={hint("delete")}>
        {language.t("common.delete")}
      </MenuV2.Item>
    </>
  )
}
