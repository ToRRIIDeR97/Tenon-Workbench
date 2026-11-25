export type ModelProfile = {
  rules: string
  enabled: boolean
  source?: string
  updatedAt: number
}

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

export function profileFor(profiles: Readonly<Record<string, ModelProfile>> | undefined, modelID: string | undefined) {
  if (!profiles || !modelID) return undefined
  const short = modelID.includes("/") ? modelID.slice(modelID.lastIndexOf("/") + 1) : modelID
  const entry = Object.entries(profiles).find(
    ([key, profile]) => profile.enabled && profile.rules.trim() && (key === modelID || key === short),
  )
  return entry ? { model: entry[0], rules: entry[1].rules } : undefined
}

export const profileInstruction = (model: string, rules: string) =>
  [
    `Working rules for ${model}, from its model profile. Follow them for the whole thread.`,
    `<model-profile model="${model}">`,
    rules.trim(),
    "</model-profile>",
  ].join("\n")

export const profileDue = (input: { newThread: boolean; previousModel?: string; model: string }) =>
  input.newThread || input.previousModel !== input.model

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/

export function profileRules(rules: string) {
  return rules
    .split(/\r?\n/)
    .map((line, index) => ({ index, text: line.replace(BULLET, "").trim() }))
    .filter((rule) => rule.text && !rule.text.startsWith("#"))
}

export function removeProfileRule(rules: string, index: number) {
  return rules
    .split(/\r?\n/)
    .filter((_, line) => line !== index)
    .join("\n")
}

export function appendProfileRule(rules: string, text: string) {
  const rule = text.trim()
  if (!rule) return rules
  const body = rules.trimEnd()
  return body ? `${body}\n- ${rule}` : `- ${rule}`
}

type ModelChoice = { id: string; name: string; provider: { id: string; name: string } }

export function profileModelMatches(
  models: ReadonlyArray<ModelChoice>,
  query: string,
  existing: ReadonlyArray<string>,
  limit = 6,
) {
  const q = query.trim().toLowerCase()
  const taken = new Set(existing.map((key) => key.toLowerCase()))
  const seen = new Set<string>()
  return models
    .filter((model) => {
      const id = model.id.toLowerCase()
      if (taken.has(id) || taken.has(`${model.provider.id}/${model.id}`.toLowerCase()) || seen.has(id)) return false
      const hit = !q || [model.name, model.id, model.provider.name].some((value) => value.toLowerCase().includes(q))
      if (hit) seen.add(id)
      return hit
    })
    .toSorted(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
}
