/**
 * The model's display name: a harness that reports `provider/Model Name` (OpenCode's `opencode/…`) shows just the
 * name; the provider stays in the pill's tooltip and the panel's Model row.
 */
export function modelDisplayName(name: string) {
  const match = /^[\w.-]+\/(.+)$/.exec(name)
  return match?.[1]?.trim() || name
}

/** The pill's text: the model, then the reasoning level and speed when they aren't the default. */
export function modelPillLabel(input: { model: string; effort?: string; tier?: string }) {
  return [modelDisplayName(input.model), input.effort, input.tier].filter((part): part is string => !!part).join(" · ")
}
