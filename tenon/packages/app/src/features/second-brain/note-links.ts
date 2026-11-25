import type { NoteSummary } from "./client"

export function normalizeWikiTarget(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase()
}

export function wikiTargetKey(reference: string) {
  return normalizeWikiTarget(reference.replace(/[#^][\s\S]*$/, ""))
}

export function noteKeys(note: Pick<NoteSummary, "path" | "title">) {
  const path = normalizeWikiTarget(note.path)
  return new Set([normalizeWikiTarget(note.title), path, path.split("/").pop() ?? path])
}

export function noteLinkLookup(notes: ReadonlyArray<Pick<NoteSummary, "path" | "title">>) {
  const lookup = new Map<string, string>()
  for (const note of notes) for (const key of noteKeys(note)) lookup.set(key, note.path)
  return lookup
}

export function previewNoteLinks(body: string, lookup: ReadonlyMap<string, string>) {
  return body.replace(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`]*`+)|(?<!\\)\[\[([^\[\]\n]+)\]\]/g,
    (source, code, reference: string) => {
      if (code) return source
      const [target, alias] = reference.split("|", 2)
      const path = lookup.get(wikiTargetKey(target))
      if (!path) return source
      const label = (alias || target).replace(/[\\\[\]<>]/g, "\\$&")
      return `[${label}](/projects?note=${encodeURIComponent(path)})`
    },
  )
}
