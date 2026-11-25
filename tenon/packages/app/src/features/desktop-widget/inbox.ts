export const INBOX_PATH = "Inbox.md"

export function appendToInbox(body: string | undefined, text: string, at: Date, label: string) {
  const entry = `## ${label} · ${at.toISOString()}\n\n${text.trim()}\n`
  const current = body?.replace(/\s+$/, "")
  if (!current) return `# Inbox\n\n${entry}`
  return `${current}\n\n${entry}`
}
