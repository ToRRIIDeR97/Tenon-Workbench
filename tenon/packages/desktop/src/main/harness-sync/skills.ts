import type {
  HarnessSyncLocalSkill,
  HarnessSyncSkillsReport,
  HarnessSyncToolSkills,
} from "@tenon/app/harness-sync/types"
import type { Write } from "./apply"
import { type SyncDocument, skillSet } from "./document"
import { message } from "./fsutil"
import {
  ENTRY_FILE,
  type Skill,
  backUpSkill,
  isValidSkill,
  localSkillNames,
  readSkill,
  removeSkill,
  sameSkill,
  skillDescription,
  skillHash,
  writeSkill,
} from "./skill-files"
import type { LocalState } from "./state"
import { type Locations, TOOLS, installed, skillsDir } from "./tools"

const attempt = <T>(work: Promise<T>) =>
  work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error: message(error) }),
  )

const entry = (
  name: string,
  skill: Skill | undefined,
  wanted: boolean,
  state: HarnessSyncLocalSkill["state"],
  error?: string,
): HarnessSyncLocalSkill => ({
  name,
  description: skill ? skillDescription(skill) : "",
  files: skill ? Object.keys(skill.files).length : 0,
  wanted,
  state,
  editedOutside: false,
  autoUpload: false,
  ...(error ? { message: error } : {}),
})

const installedTools = (locations: Locations) =>
  Promise.all(TOOLS.map(async (tool) => ((await installed(locations, tool.id)) ? tool : undefined))).then((tools) =>
    tools.filter((tool) => tool !== undefined),
  )

export async function outsideEdits(document: SyncDocument, locations: Locations, state: LocalState) {
  const edits = new Map<string, Skill | null>()
  for (const tool of await installedTools(locations)) {
    for (const [name, skill] of skillSet(document, tool.id) ?? []) {
      const copy = await readSkill(locations.path.join(skillsDir(locations, tool.id), name)).catch(() => undefined)
      if (!copy) continue
      const wanted = skillHash(skill)
      const current = skillHash(copy)
      const applied = state.appliedSkills[`${tool.id}/${name}`]
      if (current === wanted || applied === current) continue
      const safe = applied === wanted && isValidSkill(name, copy)
      const other = edits.get(name)
      const agreed = other === undefined ? safe : safe && other !== null && sameSkill(other, copy)
      edits.set(name, agreed ? copy : null)
    }
  }
  return Object.fromEntries([...edits].filter((item): item is [string, Skill] => item[1] !== null))
}

export async function applySkills(
  document: SyncDocument | undefined,
  locations: Locations,
  state: LocalState,
  write: Write,
  backups?: string,
): Promise<HarnessSyncSkillsReport> {
  const library = Object.entries(document?.skills ?? {})
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, skill]) => ({ name, description: skillDescription(skill), files: Object.keys(skill.files).length }))
  const written = new Set(state.writtenSkills)
  const tools: HarnessSyncToolSkills[] = []
  for (const tool of await installedTools(locations)) {
    const dir = skillsDir(locations, tool.id)
    const wanted = document ? skillSet(document, tool.id) : undefined
    const found = new Map<string, HarnessSyncLocalSkill>()

    for (const name of await localSkillNames(dir)) {
      if (wanted?.has(name)) continue
      const read = await attempt(readSkill(locations.path.join(dir, name)))
      if ("error" in read) found.set(name, entry(name, undefined, false, "error", `${name} ${read.error}`))
      else if (read.value && Object.hasOwn(read.value.files, ENTRY_FILE))
        found.set(name, entry(name, read.value, false, "local"))
    }

    for (const [name, skill] of wanted ?? []) {
      const key = `${tool.id}/${name}`
      const target = locations.path.join(dir, name)
      const wantedHash = skillHash(skill)
      const read = await attempt(readSkill(target))
      if ("error" in read) {
        found.set(name, entry(name, skill, true, "error", `${target} ${read.error}`))
        continue
      }
      const current = read.value
      const currentHash = current ? skillHash(current) : undefined
      const applied = state.appliedSkills[key]
      const result = entry(name, skill, true, "inSync")
      if (currentHash !== wantedHash) {
        result.editedOutside = currentHash !== undefined && applied !== undefined && applied !== currentHash
        result.autoUpload = result.editedOutside && applied === wantedHash
        result.state = "differs"
        const keep = write === "keepOutsideEdits" && result.editedOutside
        if (write !== "never" && !keep) {
          const unsaved =
            current && Object.keys(current.files).length > 0 && applied !== currentHash ? current : undefined
          const saved =
            unsaved && backups
              ? await attempt(backUpSkill(backups, tool.id, name, unsaved))
              : { value: undefined as string | undefined }
          const outcome =
            "error" in saved
              ? { error: `Could not back up ${target}, so it was left alone: ${saved.error}` }
              : await writeSkill(target, skill).then(
                  () => ({ backup: saved.value }),
                  (error: unknown) => ({ error: `Could not write ${target}: ${message(error)}` }),
                )
          if ("error" in outcome) {
            result.state = "error"
            result.message = outcome.error
          } else {
            result.state = "updated"
            result.editedOutside = false
            result.autoUpload = false
            if (outcome.backup) result.backup = outcome.backup
            written.add(key)
          }
        }
      }
      if (result.state === "inSync" || result.state === "updated") state.appliedSkills[key] = wantedHash
      found.set(name, result)
    }

    if (wanted && write !== "never") {
      const prefix = `${tool.id}/`
      const gone = Object.entries(state.appliedSkills).filter(
        ([key]) => key.startsWith(prefix) && !wanted.has(key.slice(prefix.length)),
      )
      for (const [key, applied] of gone) {
        const name = key.slice(prefix.length)
        const target = locations.path.join(dir, name)
        if (written.has(key)) {
          const copy = await readSkill(target).catch(() => undefined)
          if (copy && skillHash(copy) === applied) {
            const removed = await removeSkill(target, copy).then(
              () => true,
              () => false,
            )
            if (removed) found.delete(name)
          }
        }
        delete state.appliedSkills[key]
        written.delete(key)
      }
    }

    tools.push({
      tool: tool.id,
      folder: dir,
      skills: [...found.values()].toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    })
  }
  state.writtenSkills = [...written].toSorted()
  return { library, tools }
}
