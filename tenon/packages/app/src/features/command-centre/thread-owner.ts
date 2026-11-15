/** Parent links followed to reach a subagent's root thread. Also ends a cycle. */
export const OWNER_DEPTH = 16

/**
 * The root thread a request's session belongs to: the session itself when it is one of `roots`, else the first
 * root reached by following parents. A parent comes from the synced session store when it holds the session,
 * else from the sidebar's session-index links (`links`, child to parent), which also cover subagents the store
 * has not loaded. Undefined when no root is reached.
 */
export function rootThread<T>(
  id: string,
  roots: ReadonlyMap<string, T>,
  synced: (id: string) => string | undefined,
  links: Readonly<Record<string, string>>,
  depth = 0,
): T | undefined {
  const found = roots.get(id)
  if (found || depth >= OWNER_DEPTH) return found
  const parent = synced(id) ?? links[id]
  return parent ? rootThread(parent, roots, synced, links, depth + 1) : undefined
}
