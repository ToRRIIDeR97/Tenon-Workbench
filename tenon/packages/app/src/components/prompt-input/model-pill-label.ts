export function modelDisplayName(name: string) {
  const match = /^[\w.-]+\/(.+)$/.exec(name)
  return match?.[1]?.trim() || name
}

export function modelPillLabel(input: { model: string; effort?: string; tier?: string }) {
  return [modelDisplayName(input.model), input.effort, input.tier].filter((part): part is string => !!part).join(" · ")
}

export function pillEffort(input: { offered: boolean; current?: string; resolved?: string; defaultLabel: string }) {
  if (!input.offered) return undefined
  if (input.current && input.current !== "default") return input.current
  return input.resolved || input.defaultLabel
}
