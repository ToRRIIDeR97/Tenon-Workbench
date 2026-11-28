import type { TimelineItem } from "./client"

export const TEMPLATES_FOLDER = "Templates"
export const DAILY_FOLDER = "Daily"
export const DAILY_TEMPLATE_PATH = `${TEMPLATES_FOLDER}/Daily.md`

export const BUILT_IN_DAILY = `## Focus

-

## Notes

## Done

## Tomorrow
`

export function starterTemplate(intro: string) {
  return `# {{title}}

{{date}}

${intro}

Placeholders: {{title}}, {{date}}, {{time}}, {{weekday}}, {{yesterday}}, {{tomorrow}}.
`
}

const pad = (value: number) => String(value).padStart(2, "0")

export function localDate(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

const shift = (value: Date, days: number) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, 12)

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function applyTemplate(body: string, input: { now: Date; title: string; weekday?: (date: Date) => string }) {
  const values: Record<string, () => string> = {
    title: () => input.title,
    date: () => localDate(input.now),
    time: () => `${pad(input.now.getHours())}:${pad(input.now.getMinutes())}`,
    weekday: () => (input.weekday ? input.weekday(input.now) : (WEEKDAYS[input.now.getDay()] ?? "")),
    yesterday: () => localDate(shift(input.now, -1)),
    tomorrow: () => localDate(shift(input.now, 1)),
  }
  return body.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (source, name: string) => values[name.toLowerCase()]?.() ?? source)
}

export function isTemplatePath(path: string) {
  const [folder, ...rest] = path.split("/")
  return rest.length > 0 && folder?.toLowerCase() === TEMPLATES_FOLDER.toLowerCase()
}

export function templateName(path: string) {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "")
}

export function dailyNotePath(now: Date) {
  return `${DAILY_FOLDER}/${localDate(now)}.md`
}

export type ProjectTemplateID = "blank" | "software" | "research" | "writing" | "launch"

export type ProjectTemplate = {
  id: ProjectTemplateID
  milestones: ReadonlyArray<{ title: string; weeks: number }>
  page: { title: string; body: string } | undefined
  instructions?: string
}

export const PROJECT_TEMPLATES: ReadonlyArray<ProjectTemplate> = [
  { id: "blank", milestones: [], page: undefined },
  {
    id: "software",
    milestones: [
      { title: "Plan agreed", weeks: 1 },
      { title: "First working version", weeks: 3 },
      { title: "Tested and reviewed", weeks: 5 },
      { title: "Released", weeks: 6 },
    ],
    page: {
      title: "Design notes",
      body: "## Goal\n\n## Constraints\n\n## Approach\n\n## Open questions\n\n## Decisions\n",
    },
    instructions: "Run the project's tests before saying a change is done. Keep changes small and explain them.",
  },
  {
    id: "research",
    milestones: [
      { title: "Question framed", weeks: 1 },
      { title: "Sources gathered", weeks: 2 },
      { title: "Findings written up", weeks: 4 },
    ],
    page: {
      title: "Research log",
      body: "## Question\n\n## Sources\n\n- \n\n## Findings\n\n## Next steps\n",
    },
    instructions: "Cite every source you use and say how confident you are in each finding.",
  },
  {
    id: "writing",
    milestones: [
      { title: "Outline", weeks: 1 },
      { title: "First draft", weeks: 3 },
      { title: "Edited draft", weeks: 4 },
      { title: "Published", weeks: 5 },
    ],
    page: { title: "Outline", body: "## Audience\n\n## Main point\n\n## Sections\n\n1. \n" },
  },
  {
    id: "launch",
    milestones: [
      { title: "Scope fixed", weeks: 1 },
      { title: "Materials ready", weeks: 3 },
      { title: "Launch day", weeks: 4 },
      { title: "Follow-up done", weeks: 6 },
    ],
    page: {
      title: "Launch checklist",
      body: "## Before\n\n- [ ] \n\n## On the day\n\n- [ ] \n\n## After\n\n- [ ] \n",
    },
  },
]

export function projectTemplate(id: string) {
  return PROJECT_TEMPLATES.find((template) => template.id === id)
}

export function timelineFromTemplate(template: ProjectTemplate, start: Date, makeId: () => string): TimelineItem[] {
  return [...template.milestones]
    .sort((left, right) => left.weeks - right.weeks)
    .map((milestone) => ({
      id: makeId(),
      title: milestone.title,
      kind: "milestone" as const,
      status: "todo" as const,
      start: localDate(shift(start, milestone.weeks * 7)),
    }))
}
