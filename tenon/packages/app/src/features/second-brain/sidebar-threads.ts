import { pathKey } from "@/utils/path-key"
import { sessionPinnedAt } from "@/utils/session"

export type SidebarSession = {
  id: string
  parentID?: string
  directory: string
  time: { created: number; updated?: number; archived?: number }
  metadata?: { [key: string]: unknown }
}

export type SidebarProject = { id: string; threadDirectory: string }

export type ThreadNode<S extends SidebarSession = SidebarSession> = { session: S; children: ThreadNode<S>[] }

export type SidebarGroups<P extends SidebarProject, S extends SidebarSession> = {
  projects: Array<{ project: P; threads: ThreadNode<S>[] }>
  workspace: ThreadNode<S>[]
}

const recent = (session: SidebarSession) => session.time.updated ?? session.time.created

const compareRoots = (a: SidebarSession, b: SidebarSession) =>
  (sessionPinnedAt(b) ?? 0) - (sessionPinnedAt(a) ?? 0) || recent(b) - recent(a)

export function buildThreadTree<S extends SidebarSession>(sessions: readonly S[]): ThreadNode<S>[] {
  const unique = [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
  const nodes = new Map(unique.map((session) => [session.id, { session, children: [] as ThreadNode<S>[] }]))
  const roots: ThreadNode<S>[] = []
  for (const node of nodes.values()) {
    const parent = node.session.parentID ? nodes.get(node.session.parentID) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const sortChildren = (node: ThreadNode<S>) => {
    node.children.sort((a, b) => a.session.time.created - b.session.time.created)
    node.children.forEach(sortChildren)
  }
  roots.forEach(sortChildren)
  return roots.sort((a, b) => compareRoots(a.session, b.session))
}

const directoryPrefix = (key: string) => (key.endsWith("/") ? key : `${key}/`)

const matchesDirectory = (outer: string, prefix: string, inner: string) => inner === outer || inner.startsWith(prefix)

export function isWithinDirectory(parent: string, directory: string) {
  const outer = pathKey(parent)
  return matchesDirectory(outer, directoryPrefix(outer), pathKey(directory))
}

export function projectForDirectory<P extends SidebarProject>(projects: readonly P[], directory: string | undefined) {
  if (!directory) return
  const inner = pathKey(directory)
  let best: P | undefined
  let bestLength = -1
  for (const project of projects) {
    const outer = pathKey(project.threadDirectory)
    if (outer.length > bestLength && matchesDirectory(outer, directoryPrefix(outer), inner)) {
      best = project
      bestLength = outer.length
    }
  }
  return best
}

export function groupSidebarThreads<P extends SidebarProject, S extends SidebarSession>(input: {
  projects: readonly P[]
  workspaceDirectory?: string
  sessions: readonly S[]
}): SidebarGroups<P, S> {
  const byProject = new Map<string, S[]>()
  const workspace: S[] = []
  const rankedProjects = input.projects
    .map((project) => {
      const key = pathKey(project.threadDirectory)
      return { project, key, prefix: directoryPrefix(key) }
    })
    .sort((a, b) => b.key.length - a.key.length)
  const workspaceKey = input.workspaceDirectory ? pathKey(input.workspaceDirectory) : undefined
  const workspacePrefix = workspaceKey ? directoryPrefix(workspaceKey) : undefined
  for (const session of input.sessions) {
    if (session.time.archived) continue
    const inner = pathKey(session.directory)
    const matched = rankedProjects.find((item) => matchesDirectory(item.key, item.prefix, inner))?.project
    if (matched) {
      const list = byProject.get(matched.id)
      if (list) list.push(session)
      else byProject.set(matched.id, [session])
      continue
    }
    if (workspaceKey && workspacePrefix && matchesDirectory(workspaceKey, workspacePrefix, inner))
      workspace.push(session)
  }
  return {
    projects: input.projects.map((project) => ({ project, threads: buildThreadTree(byProject.get(project.id) ?? []) })),
    workspace: buildThreadTree(workspace),
  }
}

export function createThreadNodeCache<S extends SidebarSession>() {
  let nodes = new Map<string, ThreadNode<S>>()
  return <P extends SidebarProject>(value: SidebarGroups<P, S>): SidebarGroups<P, S> => {
    const next = new Map<string, ThreadNode<S>>()
    const reuse = (list: ThreadNode<S>[]): ThreadNode<S>[] =>
      list.map((node) => {
        const old = nodes.get(node.session.id)
        const children = reuse(node.children)
        const stable =
          old && old.session === node.session && sameItems(old.children, children) ? old : { ...node, children }
        next.set(node.session.id, stable)
        return stable
      })
    const result = {
      projects: value.projects.map((group) => ({ ...group, threads: reuse(group.threads) })),
      workspace: reuse(value.workspace),
    }
    nodes = next
    return result
  }
}

const sameItems = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((item, index) => item === b[index])

export function mergeSidebarSessions<S extends SidebarSession>(
  lists: ReadonlyArray<{ directory: string; sessions: readonly S[] }>,
  index: readonly S[],
): S[] {
  const owned = lists.flatMap((list) => {
    const key = pathKey(list.directory)
    return list.sessions.filter((session) => pathKey(session.directory) === key)
  })
  return [...owned, ...index]
}

export function hasChildThreads(node: ThreadNode, links: Readonly<Record<string, string>>) {
  return node.children.length > 0 || Object.values(links).includes(node.session.id)
}

export function childThreadsOpen(node: ThreadNode, activeSessionID: string | undefined, choice?: boolean) {
  return choice ?? containsSession(node, activeSessionID)
}

const containsSession = (node: ThreadNode, sessionID: string | undefined): boolean =>
  !!sessionID && (node.session.id === sessionID || node.children.some((child) => containsSession(child, sessionID)))

export function flattenThreads<S extends SidebarSession>(nodes: readonly ThreadNode<S>[]): S[] {
  return nodes.flatMap((node) => [node.session, ...flattenThreads(node.children)])
}
