export type ModelProfile = {
  /** The rules added to the model's instructions, in Markdown. */
  rules: string
  enabled: boolean
  /** Where the rules came from, e.g. "Imported profile.md" or a benchmark note. */
  source?: string
  updatedAt: number
}

/**
 * Reads a `profile.md` from the tor-model-profile skill: an optional front matter `model:` line, then the rules.
 * Without one, `fallbackModel` (the name the user picked) is used.
 */
export function parseProfileMarkdown(text: string, fallbackModel?: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const model = match?.[1]
    .match(/^model:\s*(.+)$/m)?.[1]
    .trim()
    .replace(/^["']|["']$/g, "")
  return {
    model: model || fallbackModel?.trim() || undefined,
    rules: (match ? text.slice(match[0].length) : text).trim(),
  }
}

/**
 * The switched-on profile for a model id. A profile may name the full id (`opencode-go/deepseek-v4.1-flash`) or
 * just the model (`deepseek-v4.1-flash`), so either matches.
 */
export function profileFor(profiles: Readonly<Record<string, ModelProfile>> | undefined, modelID: string | undefined) {
  if (!profiles || !modelID) return undefined
  const short = modelID.includes("/") ? modelID.slice(modelID.lastIndexOf("/") + 1) : modelID
  const entry = Object.entries(profiles).find(
    ([key, profile]) => profile.enabled && profile.rules.trim() && (key === modelID || key === short),
  )
  return entry ? { model: entry[0], rules: entry[1].rules } : undefined
}

/** The hidden note a profile adds to a prompt. */
export const profileInstruction = (model: string, rules: string) =>
  [
    `Working rules for ${model}, from its model profile. Follow them for the whole thread.`,
    `<model-profile model="${model}">`,
    rules.trim(),
    "</model-profile>",
  ].join("\n")

/** A thread gets the profile on its first message and again whenever its model changes. */
export const profileDue = (input: { newThread: boolean; previousModel?: string; model: string }) =>
  input.newThread || input.previousModel !== input.model
