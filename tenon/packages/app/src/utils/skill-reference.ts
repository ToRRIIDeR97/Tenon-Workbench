import type { Prompt } from "@/context/prompt"

// A skill chip in the composer is a file mention with this MIME type. It is never sent as a file:
// on submit each chip becomes a synthetic text part. A Tenon skill carries its instructions, so every
// harness reads the same text; a harness's own skill is named for that harness to load itself.
export const SKILL_REFERENCE_MIME = "application/x-tenon-skill"

export const skillReferenceURI = (name: string) => `tenon-skill://${encodeURIComponent(name)}`

export const promptSkills = (prompt: Prompt) => [
  ...new Set(prompt.flatMap((part) => (part.type === "file" && part.mime === SKILL_REFERENCE_MIME ? [part.path] : []))),
]

type PickerSkill = { name: string; description?: string; enabled?: boolean }

/**
 * The "/" picker's skills: Tenon's switched-on skills, then the active harness's own, each name once. A skill can
 * be installed in more than one of a harness's folders (`~/.claude/skills` and `~/.agents/skills`, say).
 */
export function pickerSkills<T extends PickerSkill>(
  catalog: { tenon: ReadonlyArray<T>; harnesses: ReadonlyArray<{ id: string; skills: ReadonlyArray<T> }> },
  harness: string | undefined,
) {
  const own = catalog.harnesses.find((entry) => entry.id === harness)?.skills ?? []
  const seen = new Set<string>()
  return [...catalog.tenon.filter((skill) => skill.enabled !== false), ...own].filter((skill) => {
    if (seen.has(skill.name)) return false
    seen.add(skill.name)
    return true
  })
}

export const skillInstruction = (name: string, content?: string) =>
  content === undefined
    ? `The user attached your "${name}" skill to this message. Load it and follow its instructions for this request.`
    : [
        `The user attached the "${name}" skill to this message. Follow its instructions for this request.`,
        `<skill name="${name}">`,
        content.trim(),
        "</skill>",
      ].join("\n")
