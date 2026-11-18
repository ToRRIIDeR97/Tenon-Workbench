export interface CatalogSkill {
  readonly name: string
  readonly description?: string
  readonly location?: string
  readonly scope: "global" | "project"
  /** False when switched off (a harness skill: its SKILL.md renamed to SKILL.md.disabled). */
  readonly enabled?: boolean
  /** Harness skills: true when Tenon may switch it (a home or project folder, not a system one). */
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
  /** Only Tenon's own skills belong to this app; harness skills are shown read-only. */
  readonly editable: boolean
  readonly source: SkillSource
  readonly skills: CatalogSkill[]
}

/** Settings → Skills sections: Tenon first, then each harness in catalog order, skills sorted by name. */
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

/** True when the row gets a switch: every Tenon skill, and a harness skill in a folder Tenon may rename in (#323). */
export function switchable(section: SkillSection, skill: CatalogSkill) {
  return section.editable || skill.editable === true
}

/**
 * For a skill, the other sections that read the very same SKILL.md (OpenCode also reads the Claude Code folder), so
 * the row can say that switching it changes those harnesses too.
 */
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

/** The Tenon section's ID; every other section is a harness. */
export const TENON_SECTION = "tenon"

/** A row's key for saved and busy state: harnesses list skills of the same name. */
export const skillKey = (sectionId: string, name: string) => `${sectionId}\0${name}`

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
