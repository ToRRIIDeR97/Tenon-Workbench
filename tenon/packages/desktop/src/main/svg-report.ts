// What render_svg tells the agent about a rendered diagram (svg-render.ts measures it).

export type Issue = { readonly kind: "overlap" | "overflow" | "clipped" | "small"; readonly message: string }
export type Inspection = {
  readonly width: number
  readonly height: number
  readonly issues: ReadonlyArray<Issue>
  readonly total: number
}

export function report(inspection: Inspection) {
  const size = `Rendered at ${inspection.width}×${inspection.height}px, as the chat shows it.`
  if (inspection.total === 0) return `${size} No layout problems found.`
  const more =
    inspection.total > inspection.issues.length ? `\n…and ${inspection.total - inspection.issues.length} more.` : ""
  return (
    [
      `${size} ${inspection.total} layout ${inspection.total === 1 ? "problem" : "problems"} to fix before sending:`,
      ...inspection.issues.map((issue) => `- ${issue.message}`),
    ].join("\n") + more
  )
}
