import type { HarnessSyncPresets, HarnessSyncToolPreset, HarnessSyncToolStatus } from "@tenon/app/harness-sync/types"
import { type SyncDocument, preset, render } from "./document"
import { hash, readText, tryReadText, writeAtomic, message } from "./fsutil"
import type { LocalState } from "./state"
import { type Locations, TOOLS, findTool, installed, instructionsFile } from "./tools"

/** Which differing files an apply replaces: none, all but ones edited outside Tenon (automatic), or all. */
export type Write = "never" | "keepOutsideEdits" | "always"

const lineCount = (text: string) => text.split("\n").filter((line) => line.trim()).length

/** Compares every tool's instructions file with its preset and replaces differing files as `write` allows. */
export function applyInstructions(
  document: SyncDocument | undefined,
  locations: Locations,
  state: LocalState,
  write: Write,
) {
  return Promise.all(
    TOOLS.map(async (tool): Promise<HarnessSyncToolStatus> => {
      const file = instructionsFile(locations, tool.id)
      const base: HarnessSyncToolStatus = {
        id: tool.id,
        name: tool.name,
        installed: await installed(locations, tool.id),
        path: file,
        exists: false,
        lines: 0,
        mode: document ? preset(document, tool.id).mode : "shared",
        state: "detected",
        editedOutside: false,
      }
      const read = await tryReadText(file)
      if ("error" in read) return { ...base, exists: true, state: "error", message: `${file} ${read.error}` }
      const current = read.text
      const status = { ...base, exists: current !== undefined, lines: current ? lineCount(current) : 0 }
      if (!document) return status
      if (!status.installed) return { ...status, state: "notInstalled" }
      const rendered = render(document, tool.id)
      if (rendered === undefined) return { ...status, state: "off" }
      const text = current ?? ""
      const applied = state.applied[tool.id]
      const editedOutside =
        current !== undefined && text !== rendered && applied !== undefined && applied !== hash(text)
      if (text === rendered) {
        state.applied[tool.id] = hash(rendered)
        return { ...status, state: "inSync" }
      }
      if (!rendered.trim())
        return {
          ...status,
          editedOutside,
          state: "skipped",
          message: "The preset is empty, so this file was left unchanged.",
        }
      if (write === "never" || (write === "keepOutsideEdits" && editedOutside))
        return { ...status, editedOutside, state: "differs" }
      const written = await writeAtomic(file, rendered).then(
        () => undefined,
        (error: unknown) => message(error),
      )
      if (written !== undefined)
        return { ...status, editedOutside, state: "error", message: `Could not write ${file}: ${written}` }
      state.applied[tool.id] = hash(rendered)
      return { ...status, state: "updated", exists: true, lines: lineCount(rendered) }
    }),
  )
}

/**
 * Presets that reproduce this computer's current instruction files. `seed`'s file becomes the shared preset. Every
 * other installed tool keeps the shared preset when its file matches, becomes "shared + extra" when its file starts
 * with the shared text, and otherwise keeps its file as its own preset. Tools that are missing, empty or turned off
 * keep their current setting, and skill choices carry over.
 */
export async function capture(document: SyncDocument, locations: Locations, seed: string) {
  const seedTool = findTool(seed)
  if (!seedTool) throw new Error("Unknown harness")
  const read = (id: (typeof TOOLS)[number]["id"]) =>
    readText(instructionsFile(locations, id)).then(
      (text) => text ?? "",
      () => "",
    )
  const shared = await read(seedTool.id)
  if (!shared.trim()) throw new Error(`${seedTool.name} has no instructions on this computer`)
  const base = shared.trimEnd()
  const tools = await Promise.all(
    TOOLS.map(async (tool) => {
      const existing = preset(document, tool.id)
      const keep = (mode: HarnessSyncToolPreset["mode"], text: string) => ({ ...existing, mode, text })
      if (tool.id === seedTool.id) return [tool.id, keep("shared", "")] as const
      const text = await read(tool.id)
      if (!(await installed(locations, tool.id)) || existing.mode === "off" || !text.trim())
        return [tool.id, existing] as const
      if (text.trimEnd() === base) return [tool.id, keep("shared", "")] as const
      const rest = text.startsWith(base) ? text.slice(base.length) : undefined
      if (rest?.startsWith("\n")) return [tool.id, keep("append", rest.trimStart())] as const
      return [tool.id, keep("custom", text)] as const
    }),
  )
  return {
    shared,
    tools: Object.fromEntries(tools),
    sharedSkills: document.sharedSkills,
    skillSources: {},
  } satisfies HarnessSyncPresets
}
