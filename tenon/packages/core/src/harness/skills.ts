export * as HarnessSkills from "./skills"

import fs from "fs/promises"
import path from "path"
import { Effect, Schema } from "effect"
import { Harness as HarnessSchema } from "@tenon/schema/harness"
import { ConfigMarkdown } from "../config/markdown"
import { Global } from "../global"
import { HarnessRuntime } from "../harness"
import { Location } from "../location"
import { SkillV2 } from "../skill"
import { SkillToggle } from "../skill/toggle"
import { Glob } from "../util/glob"

export type Harness = { id: string; driver: string; command?: string }
export type Reported = ReadonlyArray<{ name: string; description?: string }>
export type Skill = {
  name: string
  description?: string
  location?: string
  scope: "global" | "project"
  /** False when switched off in Settings → Skills (for a harness skill: its SKILL.md renamed, #323). */
  enabled?: boolean
  /** Harness skills only: true when the skill sits in a folder Tenon may switch it in (home or project). */
  editable?: boolean
}

/** The suffix that switches a harness skill off: every harness loads skills by the exact file name SKILL.md. */
export const DISABLED_SUFFIX = ".disabled"
export type Source = "filesystem" | "reported" | "none"

/**
 * Skills a harness can use, read from the folders that harness loads them from. Read-only: only names,
 * descriptions and file paths are returned, never skill content. A harness without known folders falls
 * back to the commands it reported over ACP.
 */
export const scan = Effect.fn("HarnessSkills.scan")(function* (input: {
  home: string
  directory: string
  harness: Harness
  reported?: Reported
}) {
  const folders = locations(input.harness)
  if (!folders) return fromReport(input.harness, input.reported)
  const levels = yield* projectLevels(input.directory)
  const roots = [
    ...folders.global.map((folder) => ({
      root: path.join(input.home, folder),
      scope: "global" as const,
      editable: true,
    })),
    // System folders belong to an administrator; Tenon lists their skills but never renames them.
    ...(folders.system ?? []).map((root) => ({ root, scope: "global" as const, editable: false })),
    ...levels.flatMap((level) =>
      folders.project.map((folder) => ({ root: path.join(level, folder), scope: "project" as const, editable: true })),
    ),
  ]
  const seen = new Set<string>()
  // A skill can sit in two of a harness's folders (OpenCode reads both `~/.claude/skills` and `~/.agents/skills`);
  // the first one found is listed.
  const names = new Set<string>()
  const skills: Skill[] = []
  for (const item of roots) {
    for (const location of yield* skillFiles(item.root)) {
      if (seen.has(location)) continue
      seen.add(location)
      const skill = yield* read(location, item.scope)
      if (!skill || names.has(skill.name)) continue
      names.add(skill.name)
      skills.push({ ...skill, enabled: !location.endsWith(DISABLED_SUFFIX), editable: item.editable })
    }
  }
  return { source: "filesystem" as Source, skills }
})

/**
 * Tenon's skills, then the skills of every external harness in settings order. Settings come from the
 * registry and config, so building the catalog never starts a harness CLI. The in-process agent is left
 * out: its skills are Tenon's.
 */
export const catalog = Effect.fn("HarnessSkills.catalog")(function* () {
  const skills = yield* SkillV2.Service
  const harnesses = yield* HarnessRuntime.Service
  const location = yield* Location.Service
  const tenon = tenonSkills(
    yield* skills.all(),
    yield* skills.sources(),
    yield* SkillToggle.disabled(Global.make().config),
  )
  const external = (yield* harnesses.settings()).filter((entry) => entry.driver !== HarnessSchema.OpenCodeDriver)
  return {
    tenon,
    harnesses: yield* Effect.forEach(external, (entry) =>
      scan({
        // Global.Service lives outside location scope; its home is this same path.
        home: Global.Path.home,
        directory: location.directory,
        harness: { id: entry.id, driver: entry.driver, command: entry.command },
        reported: harnesses.reportedCommands(entry.id),
      }).pipe(Effect.map((result) => ({ id: entry.id, name: entry.name, ...result }))),
    ),
  }
})

export class UnknownSkill extends Schema.TaggedError<UnknownSkill>()("HarnessSkills.UnknownSkill", {
  message: Schema.String,
}) {}

export class SwitchFailed extends Schema.TaggedError<SwitchFailed>()("HarnessSkills.SwitchFailed", {
  message: Schema.String,
}) {}

/**
 * Switches one of Tenon's skills on or off, or with `harness` that harness's skill. A harness skill is switched by
 * renaming its SKILL.md to SKILL.md.disabled and back (#323); the skill is found by name in the harness's own
 * folders, so the caller never names a path.
 */
export const setEnabled = Effect.fn("HarnessSkills.setEnabled")(function* (
  name: string,
  enabled: boolean,
  harness?: string,
) {
  if (harness !== undefined) {
    const harnesses = yield* HarnessRuntime.Service
    const location = yield* Location.Service
    const entry = (yield* harnesses.settings()).find((item) => item.id === harness)
    if (!entry || entry.driver === HarnessSchema.OpenCodeDriver)
      return yield* new UnknownSkill({ message: `No external harness has ID "${harness}".` })
    return yield* switchSkill({
      home: Global.Path.home,
      directory: location.directory,
      harness: { id: entry.id, driver: entry.driver, command: entry.command },
      name,
      enabled,
    })
  }
  const skills = yield* SkillV2.Service
  if (!(yield* skills.all()).some((skill) => skill.name === name))
    return yield* new UnknownSkill({ message: `"${name}" isn't one of Tenon's skills.` })
  const disabled = yield* SkillToggle.set(Global.make().config, name, enabled)
  return { name, enabled: !disabled.has(name) }
})

/** Renames a harness skill's SKILL.md to switch it, after finding it by name where the harness loads skills. */
export const switchSkill = Effect.fn("HarnessSkills.switchSkill")(function* (input: {
  home: string
  directory: string
  harness: Harness
  name: string
  enabled: boolean
}) {
  const found = (yield* scan(input)).skills.find((skill) => skill.name === input.name)
  if (!found?.location || !found.editable)
    return yield* new UnknownSkill({ message: `"${input.name}" isn't a skill Tenon can switch for this harness.` })
  const target = toggledLocation(found.location, input.enabled)
  if (target !== found.location) yield* rename(found.location, target)
  return { name: input.name, enabled: input.enabled }
})

/** The SKILL.md path for the asked state: `SKILL.md` when on, `SKILL.md.disabled` when off. */
export function toggledLocation(location: string, enabled: boolean, api: Pick<typeof path, "basename"> = path) {
  const off = api.basename(location).endsWith(DISABLED_SUFFIX)
  if (enabled && off) return location.slice(0, -DISABLED_SUFFIX.length)
  if (!enabled && !off) return location + DISABLED_SUFFIX
  return location
}

// A file already at the target (a newer SKILL.md beside a disabled one) is never overwritten.
const rename = (from: string, to: string) =>
  Effect.tryPromise({
    try: async () => {
      const taken = await fs.stat(to).then(
        () => true,
        () => false,
      )
      if (taken) throw new Error(`${path.basename(to)} already exists in ${path.dirname(to)}.`)
      await fs.rename(from, to)
    },
    catch: (cause) => new SwitchFailed({ message: cause instanceof Error ? cause.message : String(cause) }),
  })

/** Tenon's skills for the catalog. Embedded skills ship inside the app, so they have no file location. */
export function tenonSkills(
  skills: ReadonlyArray<SkillV2.Info>,
  sources: ReadonlyArray<SkillV2.Source>,
  disabled: ReadonlySet<string> = new Set(),
): Skill[] {
  // A file-based skill can replace an embedded one of the same name, so match the location too.
  const embedded = new Set(
    sources.flatMap((source) => (source.type === "embedded" ? [`${source.skill.name}\0${source.skill.location}`] : [])),
  )
  return skills.map((skill) => ({
    name: skill.name,
    ...(skill.description === undefined ? {} : { description: skill.description }),
    ...(embedded.has(`${skill.name}\0${skill.location}`) ? {} : { location: skill.location }),
    scope: "global",
    enabled: !disabled.has(skill.name),
  }))
}

/**
 * Each harness's documented skill folders: `global` relative to the home directory, `system` absolute, and
 * `project` relative to every level from the working directory up to the repository root.
 * Codex: https://learn.chatgpt.com/docs/build-skills (`~/.codex/skills` also holds the skills Codex installs
 * itself). OpenCode: https://opencode.ai/docs/skills/ (plus the legacy singular `skill` folder).
 * Claude Code: https://code.claude.com/docs/en/skills. Undefined when the harness has none known.
 */
export function locations(harness: Harness): { global: string[]; system?: string[]; project: string[] } | undefined {
  if (harness.driver === "codex")
    return { global: [".agents/skills", ".codex/skills"], system: ["/etc/codex/skills"], project: [".agents/skills"] }
  if (harness.driver !== "acp") return undefined
  const command = commandName(harness.command)
  if (command.startsWith("opencode"))
    return {
      global: [".config/opencode/skills", ".config/opencode/skill", ".claude/skills", ".agents/skills"],
      project: [".opencode/skills", ".opencode/skill", ".claude/skills", ".agents/skills"],
    }
  if (command.startsWith("claude")) return { global: [".claude/skills"], project: [".claude/skills"] }
  return undefined
}

/**
 * The working directory and each parent up to the repository root (the first level holding `.git`), nearest
 * first, the way Codex, OpenCode and Claude Code walk up for project skills. Outside a repository only the
 * working directory itself is searched.
 */
const projectLevels = Effect.fn("HarnessSkills.projectLevels")(function* (directory: string) {
  const levels: string[] = []
  let current = path.resolve(directory)
  while (true) {
    levels.push(current)
    const repository = yield* Effect.promise(() =>
      fs.stat(path.join(current, ".git")).then(
        () => true,
        () => false,
      ),
    )
    if (repository) return levels
    const parent = path.dirname(current)
    if (parent === current) return [path.resolve(directory)]
    current = parent
  }
})

/** The command's file name, lowercased and without extension, for either path style. */
function commandName(command: string | undefined) {
  const base = (command ?? "").trim().split(/[\\/]/).at(-1) ?? ""
  const dot = base.lastIndexOf(".")
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase()
}

function fromReport(harness: Harness, reported: Reported | undefined) {
  if (harness.driver !== "acp" || !reported?.length) return { source: "none" as Source, skills: [] as Skill[] }
  return {
    source: "reported" as Source,
    skills: reported.map(
      (item): Skill => ({
        name: item.name,
        ...(item.description === undefined ? {} : { description: item.description }),
        scope: "global",
      }),
    ),
  }
}

// A missing or unreadable folder simply has no skills.
// A switched-off skill's SKILL.md.disabled is listed too, so it can be switched back on.
const skillFiles = (root: string) =>
  Effect.tryPromise(() =>
    Glob.scan("**/SKILL.md{,.disabled}", { cwd: root, absolute: true, dot: true, symlink: true }),
  ).pipe(
    Effect.map((files) => files.toSorted()),
    Effect.catch(() => Effect.succeed([] as string[])),
  )

const read = (location: string, scope: Skill["scope"]) =>
  Effect.tryPromise(() => fs.readFile(location, "utf8")).pipe(
    Effect.map((content): Skill => {
      const data = ConfigMarkdown.parseOption(content)?.data
      const name =
        typeof data?.name === "string" && data.name.trim() ? data.name.trim() : path.basename(path.dirname(location))
      const description = typeof data?.description === "string" ? data.description : undefined
      return { name, ...(description === undefined ? {} : { description }), location, scope }
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  )
