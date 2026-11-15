export interface CatalogSkill {
  readonly name: string
  readonly description?: string
  readonly location?: string
  readonly scope: "global" | "project"
  /** Tenon skills only: false when switched off. */
  readonly enabled?: boolean
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
  /** Only Tenon's own skills belong to this app; harness skills are shown read-only. */
  readonly editable: boolean
  readonly source: SkillSource
  readonly skills: CatalogSkill[]
}

/** Settings → Skills sections: Tenon first, then each harness in catalog order, skills sorted by name. */
export function skillSections(catalog: SkillCatalog): SkillSection[] {
  return [
    { id: "tenon", title: "Tenon", editable: true, source: "filesystem", skills: sorted(catalog.tenon) },
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

/**
 * A Tenon skill without a file location ships inside the app. Harness sections can list location-less
 * entries too (commands a harness reported), and those are not built-in.
 */
export function isBuiltInSkill(skill: CatalogSkill, tenonSection: boolean) {
  return tenonSection && !skill.location
}

/**
 * The sections to show for a search and a chosen section ("all" for every one): skills whose name or
 * description holds every word of the query. Sections left empty by a search are dropped; an unfiltered empty
 * section stays, so its empty state still explains itself.
 */
export function filterSections(sections: ReadonlyArray<SkillSection>, query: string, section: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (skill: CatalogSkill) =>
    words.every((word) => `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(word))
  return sections
    .filter((item) => section === "all" || item.id === section)
    .map((item) => ({ ...item, skills: item.skills.filter(matches) }))
    .filter((item) => words.length === 0 || item.skills.length > 0)
}

/** For each skill name, the other sections that also have it, for an "also in" tag. */
export function alsoIn(sections: ReadonlyArray<SkillSection>) {
  const owners = new Map<string, string[]>()
  for (const section of sections)
    for (const skill of section.skills) owners.set(skill.name, [...(owners.get(skill.name) ?? []), section.title])
  return (sectionTitle: string, name: string) => (owners.get(name) ?? []).filter((title) => title !== sectionTitle)
}
