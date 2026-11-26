import { syncError } from "./error"

export type Store = {
  get(name: string): Promise<{ bytes: Uint8Array; generation: string } | undefined>
  put(name: string, bytes: Uint8Array, options?: { ifGeneration?: string | null }): Promise<{ generation: string }>
  list(prefix: string): Promise<Array<{ name: string; generation: string; size: number }>>
  remove(name: string): Promise<void>
}

const PART = /^[A-Za-z0-9._-]+$/

export function isPart(part: unknown): part is string {
  return typeof part === "string" && PART.test(part) && part !== "." && part !== ".."
}

export function isName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.split("/").every(isPart)
}

export function requireName(name: string) {
  if (!isName(name)) throw syncError("invalid_name", "A store name is one or more safe parts joined by /")
  return name
}

export function requirePrefix(prefix: string) {
  if (typeof prefix !== "string" || !isName(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix))
    throw syncError("invalid_name", "A store prefix is a store name, optionally ending in /")
  return prefix
}

export function requireBytes(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array)) throw syncError("invalid_segment", "A stored object is bytes")
  return bytes
}

export function byName(left: { name: string }, right: { name: string }) {
  if (left.name < right.name) return -1
  if (left.name > right.name) return 1
  return 0
}
