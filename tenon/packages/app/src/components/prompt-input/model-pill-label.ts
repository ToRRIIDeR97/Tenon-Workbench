/** The pill's text: the model, then the reasoning level and speed when they aren't the default. */
export function modelPillLabel(input: { model: string; effort?: string; tier?: string }) {
  return [input.model, input.effort, input.tier].filter((part): part is string => !!part).join(" · ")
}
