const BRANCH_LIMIT = 60
const PREFIX = "tenon/"

export function suggestBranch(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BRANCH_LIMIT - PREFIX.length)
    .replace(/-+$/g, "")
  return `${PREFIX}${slug || "changes"}`
}

export function pullRequestDraft(message: string, threadTitle: string) {
  const [first = "", ...rest] = message.trim().split("\n")
  const details = rest.join("\n").trim()
  const footer = threadTitle.trim() ? `Made in the Tenon thread “${threadTitle.trim()}”.` : ""
  return { title: first.trim(), body: [details, footer].filter(Boolean).join("\n\n") }
}
