const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Shows the paths in a step's target relative to the workspace: `C:\Users\me\ws\src\a.ts` reads `src\a.ts`, and
 * the workspace itself reads `.`. Paths inside commands are shortened too; anything outside the workspace is left
 * alone. Windows roots (drive letter or UNC) match case-insensitively and with either separator.
 */
export function workspaceRelative(text: string, root: string | undefined) {
  if (!text || !root) return text
  const segments = root.split(/[\\/]+/).filter(Boolean)
  if (segments.length === 0) return text
  const drive = /^[a-z]:/i.test(root)
  const unc = !drive && /^[\\/]{2}[^\\/]/.test(root)
  const lead = unc ? "[\\\\/]{2}" : root.startsWith("/") ? "/" : ""
  const body = segments.map(escape).join("[\\\\/]+")
  const pattern = new RegExp(
    `(?<![\\w.\\\\/-])${lead}${body}(?:([\\\\/]+)|(?=$|[\\s"'\`;,)]))`,
    drive || unc ? "gi" : "g",
  )
  return text.replace(pattern, (_match, separator?: string) => (separator ? "" : "."))
}
