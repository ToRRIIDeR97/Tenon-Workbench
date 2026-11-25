import path from "path"

function stripPrefix(relativePath: string, prefixes: string[]) {
  const normalized = relativePath.replaceAll("\\", "/")
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length)
  }
}

export function configEntryNameFromPath(relativePath: string, prefixes: string[]) {
  const candidate = stripPrefix(relativePath, prefixes) ?? path.basename(relativePath)
  const ext = path.extname(candidate)
  return ext.length ? candidate.slice(0, -ext.length) : candidate
}
