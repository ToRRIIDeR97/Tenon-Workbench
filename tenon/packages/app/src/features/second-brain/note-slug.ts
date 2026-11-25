export function noteSlug(title: string, now = Date.now()) {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return slug || `note-${now.toString(36)}`
}
