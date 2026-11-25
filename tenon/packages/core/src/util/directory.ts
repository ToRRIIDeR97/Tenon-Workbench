import path from "node:path"

export function canonicalDirectory(input: string, platform: NodeJS.Platform = process.platform) {
  if (platform !== "win32") return path.posix.resolve(input)
  const resolved = path.win32.resolve(input)
  return /^[a-z]:/.test(resolved) ? resolved[0]!.toUpperCase() + resolved.slice(1) : resolved
}
