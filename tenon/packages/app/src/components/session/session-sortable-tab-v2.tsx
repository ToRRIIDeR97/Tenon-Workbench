import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useSortable } from "@dnd-kit/solid/sortable"
import { FileIcon } from "@tenon/ui/file-icon"
import { TabsV2 } from "@tenon/ui/v2/tabs-v2"
import { getFilename } from "@tenon/core/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { SessionTabClose } from "./session-tab-close"

export function FileVisual(props: { path: string; active?: boolean; temporary?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <Show
        when={!props.active}
        fallback={<FileIcon node={{ path: props.path, type: "file" }} class="size-4 shrink-0" />}
      >
        <span class="relative inline-flex size-4 shrink-0">
          <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
          <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
        </span>
      </Show>
      <span class="truncate font-mono" classList={{ italic: props.temporary }}>
        {getFilename(props.path)}
      </span>
    </div>
  )
}

export function SortableTabV2(props: {
  tab: string
  index: () => number
  temporary?: boolean
  onTabClose: (tab: string) => void
  onTabDoubleClick?: (tab: string) => void
  class?: string
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = useSortable({
    get id() {
      return props.tab
    },
    get index() {
      return props.index()
    },
  })
  const path = createMemo(() => file.pathFromTab(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} temporary={props.temporary} />
  })
  return (
    <div ref={sortable.ref} class={`h-full flex items-center${props.class ? ` ${props.class}` : ""}`}>
      <TabsV2.Trigger
        value={props.tab}
        onMiddleClick={() => props.onTabClose(props.tab)}
        onDblClick={() => props.onTabDoubleClick?.(props.tab)}
      >
        <Show when={content()}>{(value) => value()}</Show>
        <SessionTabClose
          label={language.t("common.closeTab")}
          keybind={command.keybindParts("tab.close")}
          onClose={() => props.onTabClose(props.tab)}
        />
      </TabsV2.Trigger>
    </div>
  )
}
