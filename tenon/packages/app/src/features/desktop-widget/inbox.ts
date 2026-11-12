/** The vault page quick notes go to; routines file their results in the same page (`agents/routines.ts`). */
export const INBOX_PATH = "Inbox.md"

/**
 * The Inbox's body with a quick note added as its own dated entry, in the shape routines use
 * (`## <name> · <ISO time>`, then the text). A missing or empty Inbox starts with its `# Inbox` heading.
 */
export function appendToInbox(body: string | undefined, text: string, at: Date, label: string) {
  const entry = `## ${label} · ${at.toISOString()}\n\n${text.trim()}\n`
  const current = body?.replace(/\s+$/, "")
  if (!current) return `# Inbox\n\n${entry}`
  return `${current}\n\n${entry}`
}
