/** The app's one progress bar: a 6px pill track with an accent fill, exposed as a meter. */
export function Meter(props: { value: number; label: string; class?: string }) {
  return (
    <span
      class={`h-1.5 min-w-0 overflow-hidden rounded-full bg-v2-background-bg-layer-02 ${props.class ?? ""}`}
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.value)}
    >
      <span
        class="block h-full rounded-full bg-v2-icon-icon-accent transition-[width] duration-medium ease-standard motion-reduce:transition-none"
        style={{ width: `${Math.max(2, Math.min(100, Math.round(props.value)))}%` }}
      />
    </span>
  )
}
