import { Icon } from "@tenon/ui/v2/icon"
import { Reveal } from "@tenon/ui/v2/reveal"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { ProjectRecord, VaultPageInfo } from "./client"

type Node = {
  key: string
  label: string
  kind: "group" | "project" | "page"
  /** Project id or page path. */
  target: string
  children: Node[]
}

/**
 * The Notes page tree: a "Projects" group (each Project with its pages beneath) and a "Workspace pages" group.
 * Follows the ARIA tree pattern: one tab stop, arrows move and expand, Enter opens.
 */
export function NotesTree(props: {
  projects: ReadonlyArray<ProjectRecord>
  pages: ReadonlyArray<VaultPageInfo>
  activeProject?: string
  activePage?: string
  onProject: (id: string) => void
  onPage: (path: string) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ collapsed: {} as Record<string, boolean>, focused: "" })
  const nodes = createMemo((): Node[] => {
    const known = new Set(props.projects.map((project) => project.id))
    const page = (info: VaultPageInfo): Node => ({
      key: `page:${info.path}`,
      label: info.title,
      kind: "page",
      target: info.path,
      children: [],
    })
    // Sorted by title so the tree holds still while pages are edited (the list itself is newest first).
    const byTitle = (items: VaultPageInfo[]) => items.sort((left, right) => left.title.localeCompare(right.title))
    return [
      {
        key: "group:projects",
        label: language.t("secondBrain.vault.projects"),
        kind: "group",
        target: "",
        children: props.projects.map((project) => ({
          key: `project:${project.id}`,
          label: project.name,
          kind: "project",
          target: project.id,
          children: byTitle(props.pages.filter((info) => info.projectId === project.id)).map(page),
        })),
      },
      {
        key: "group:workspace",
        label: language.t("secondBrain.vault.workspacePages"),
        kind: "group",
        target: "",
        // Pages of a Project this workspace no longer lists stay reachable here.
        children: byTitle(props.pages.filter((info) => !info.projectId || !known.has(info.projectId))).map(page),
      },
    ]
  })
  const activeKey = () =>
    props.activePage
      ? `page:${props.activePage}`
      : props.activeProject
        ? `project:${props.activeProject}`
        : "group:projects"
  const tabStop = () => state.focused || activeKey()
  const expanded = (node: Node) => node.children.length > 0 && !state.collapsed[node.key]
  const activate = (node: Node) => {
    if (node.kind === "group") return setState("collapsed", node.key, (value) => !value)
    if (node.kind === "project") return props.onProject(node.target)
    props.onPage(node.target)
  }
  let tree: HTMLUListElement | undefined

  const onKeyDown = (event: KeyboardEvent) => {
    // A group still collapsing is inert; its rows are no longer stops.
    const items = [...(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].filter(
      (element) => !element.closest("[inert]"),
    )
    const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="treeitem"]') : null
    const index = current ? items.indexOf(current) : -1
    if (!current || index < 0) return
    const key = current.dataset.key ?? ""
    const move = (next: number) => items[Math.max(0, Math.min(items.length - 1, next))]?.focus()
    const handled = {
      ArrowDown: () => move(index + 1),
      ArrowUp: () => move(index - 1),
      Home: () => move(0),
      End: () => move(items.length - 1),
      ArrowRight: () => {
        if (current.getAttribute("aria-expanded") === "false") return setState("collapsed", key, false)
        if (current.getAttribute("aria-expanded") === "true") move(index + 1)
      },
      ArrowLeft: () => {
        if (current.getAttribute("aria-expanded") === "true") return setState("collapsed", key, true)
        current.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus()
      },
      Enter: () => current.click(),
      " ": () => current.click(),
    }[event.key]
    if (!handled) return
    event.preventDefault()
    handled()
  }

  const Item = (item: { node: Node; level: number }) => (
    <li
      role="treeitem"
      data-key={item.node.key}
      aria-level={item.level}
      aria-expanded={item.node.children.length > 0 ? expanded(item.node) : undefined}
      aria-selected={item.node.kind === "group" ? undefined : activeKey() === item.node.key}
      tabIndex={tabStop() === item.node.key ? 0 : -1}
      class="group/item outline-none"
      onFocus={() => setState("focused", item.node.key)}
      onClick={(event) => {
        event.stopPropagation()
        activate(item.node)
      }}
    >
      <div
        classList={{
          "flex min-w-0 cursor-pointer items-center gap-1 rounded-full pr-3 transition-colors duration-short ease-standard motion-reduce:transition-none group-focus-visible/item:ring-2 group-focus-visible/item:ring-v2-border-border-focus": true,
          "h-8 text-[12px] text-v2-text-text-muted [font-weight:500] hover:text-v2-text-text-base":
            item.node.kind === "group",
          "h-8 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover": item.node.kind !== "group",
          "!bg-v2-background-bg-accent-container !text-v2-text-text-on-accent-container [font-weight:500]":
            item.node.kind !== "group" && activeKey() === item.node.key,
        }}
        style={{ "padding-left": `${8 + (item.level - 1) * 14}px` }}
      >
        <span
          aria-hidden="true"
          class="flex size-4 shrink-0 items-center justify-center text-v2-icon-icon-muted"
          onClick={(event) => {
            if (item.node.children.length === 0 || item.node.kind === "group") return
            event.stopPropagation()
            setState("collapsed", item.node.key, (value) => !value)
          }}
        >
          <Show when={item.node.children.length > 0}>
            <Icon
              name="chevron-right"
              size="small"
              class="transition-transform duration-short ease-standard motion-reduce:transition-none"
              classList={{ "rotate-90": expanded(item.node) }}
            />
          </Show>
        </span>
        <span class="min-w-0 flex-1 truncate">{item.node.label}</span>
      </div>
      <Reveal open={expanded(item.node)}>
        <ul role="group" class="flex flex-col gap-px">
          <For each={item.node.children}>{(child) => <Item node={child} level={item.level + 1} />}</For>
        </ul>
      </Reveal>
      <Show when={item.node.key === "group:projects" && item.node.children.length === 0}>
        <p class="pb-1 pr-3 text-[12px] text-v2-text-text-faint" style={{ "padding-left": "28px" }}>
          {language.t("secondBrain.vault.projectsEmpty")}
        </p>
      </Show>
    </li>
  )

  return (
    <ul
      ref={tree}
      role="tree"
      aria-label={language.t("secondBrain.vault.tree")}
      class="flex flex-col gap-px"
      onKeyDown={onKeyDown}
    >
      <For each={nodes()}>{(node) => <Item node={node} level={1} />}</For>
    </ul>
  )
}
