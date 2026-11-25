export interface CatalogSkill {
  readonly name: string
  readonly description?: string
  readonly location?: string
  readonly scope: "global" | "project"
  readonly enabled?: boolean
  readonly editable?: boolean
}

export type SkillSource = "filesystem" | "reported" | "none"

export interface SkillCatalog {
  readonly tenon: ReadonlyArray<CatalogSkill>
  readonly harnesses: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly source: SkillSource
    readonly skills: ReadonlyArray<CatalogSkill>
  }>
}

export interface SkillSection {
  readonly id: string
  readonly title: string
  readonly editable: boolean
  readonly source: SkillSource
  readonly skills: CatalogSkill[]
}

export function skillSections(catalog: SkillCatalog): SkillSection[] {
  return [
    { id: TENON_SECTION, title: "Tenon", editable: true, source: "filesystem", skills: sorted(catalog.tenon) },
    ...catalog.harnesses.map((harness) => ({
      id: harness.id,
      title: harness.name,
      editable: false,
      source: harness.source,
      skills: sorted(harness.skills),
    })),
  ]
}

function sorted(skills: ReadonlyArray<CatalogSkill>) {
  return skills.toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

export function switchable(section: SkillSection, skill: CatalogSkill) {
  return section.editable || skill.editable === true
}

export function sharedWith(sections: ReadonlyArray<SkillSection>) {
  return (sectionId: string, skill: CatalogSkill) =>
    skill.location
      ? sections
          .filter(
            (section) => section.id !== sectionId && section.skills.some((item) => item.location === skill.location),
          )
          .map((section) => section.title)
      : []
}

export const TENON_SECTION = "tenon"

export const skillKey = (sectionId: string, name: string) => `${sectionId}\0${name}`

export function isBuiltInSkill(skill: CatalogSkill, tenonSection: boolean) {
  return tenonSection && !skill.location
}

export function filterSections(sections: ReadonlyArray<SkillSection>, query: string, section: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (skill: CatalogSkill) =>
    words.every((word) => `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(word))
  return sections
    .filter((item) => section === "all" || item.id === section)
    .map((item) => ({ ...item, skills: item.skills.filter(matches) }))
    .filter((item) => words.length === 0 || item.skills.length > 0)
}

export function alsoIn(sections: ReadonlyArray<SkillSection>) {
  const owners = new Map<string, string[]>()
  for (const section of sections)
    for (const skill of section.skills) owners.set(skill.name, [...(owners.get(skill.name) ?? []), section.title])
  return (sectionTitle: string, name: string) => (owners.get(name) ?? []).filter((title) => title !== sectionTitle)
}
