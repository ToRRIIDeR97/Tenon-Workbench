/**
 * The model's display name: a harness that reports `provider/Model Name` (OpenCode's `opencode/…`) shows just the
 * name; the provider stays in the pill's tooltip and the panel's Model row.
 */
export function modelDisplayName(name: string) {
  const match = /^[\w.-]+\/(.+)$/.exec(name)
  return match?.[1]?.trim() || name
}

/** The pill's text: the model, then the reasoning level and speed when given. */
export function modelPillLabel(input: { model: string; effort?: string; tier?: string }) {
  return [modelDisplayName(input.model), input.effort, input.tier].filter((part): part is string => !!part).join(" · ")
}

/**
 * The reasoning level the pill shows whenever the model offers levels: the chosen one; on default, the level that
 * default resolves to when the harness reports it, else the word for default, so it still reads as a setting.
 */
export function pillEffort(input: { offered: boolean; current?: string; resolved?: string; defaultLabel: string }) {
  if (!input.offered) return undefined
  if (input.current && input.current !== "default") return input.current
  return input.resolved || input.defaultLabel
}
