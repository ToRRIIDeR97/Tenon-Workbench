export * as VcsPublish from "./vcs-publish"

const BRANCH_LIMIT = 60
const PREFIX = "tenon/"

export function validBranchName(name: string) {
  if (!name || name === "@" || name.length > 200) return false
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return false
  if (name.endsWith(".lock") || name.includes("..") || name.includes("//") || name.includes("@{")) return false
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name)) return false
  return name.split("/").every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"))
}

export function branchFromTitle(title: string) {
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

export function prCreateArgs(input: { title: string; body: string; base?: string; draft: boolean }) {
  if (input.base !== undefined && (!validBranchName(input.base) || input.base.startsWith("-")))
    throw new Error("invalid_base")
  return [
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    input.body,
    ...(input.base ? ["--base", input.base] : []),
    ...(input.draft ? ["--draft"] : []),
  ]
}

export function prUrl(output: string) {
  return output.match(/https?:\/\/[^\s]+\/pull\/\d+/g)?.at(-1)
}

export function messageProblem(message: string) {
  return message.trim() ? undefined : "empty"
}
