export const OWNER_DEPTH = 16

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
