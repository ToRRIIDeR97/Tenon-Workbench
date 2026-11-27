export function meterAttributes(input: { value: number; label?: string }) {
  const labelled = input.label !== undefined
  return {
    role: labelled ? ("meter" as const) : undefined,
    hidden: labelled ? undefined : true,
    label: input.label,
    min: labelled ? 0 : undefined,
    max: labelled ? 100 : undefined,
    now: labelled ? Math.round(input.value) : undefined,
  }
}

export function Meter(props: { value: number; label?: string; class?: string }) {
  const attributes = () => meterAttributes(props)
  return (
    <span
      class={`h-1.5 min-w-0 overflow-hidden rounded-full bg-v2-background-bg-layer-02 ${props.class ?? ""}`}
      role={attributes().role}
      aria-hidden={attributes().hidden}
      aria-label={attributes().label}
      aria-valuemin={attributes().min}
      aria-valuemax={attributes().max}
      aria-valuenow={attributes().now}
    >
      <span
        class="block h-full rounded-full bg-v2-icon-icon-accent transition-[width] duration-medium ease-standard motion-reduce:transition-none"
        style={{ width: `${Math.max(2, Math.min(100, Math.round(props.value)))}%` }}
      />
    </span>
  )
}
