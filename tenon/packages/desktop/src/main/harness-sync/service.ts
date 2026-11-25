import { lstat } from "node:fs/promises"
import path from "node:path"
import type { HarnessSyncPresets, HarnessSyncStatus, HarnessSyncToolID } from "@tenon/app/harness-sync/types"
import { type Write, applyInstructions, capture } from "./apply"
import { conflictCopies, create, load, parsePresets, readHash, save } from "./document"
import { nowRfc3339, readText } from "./fsutil"
import { type Skill, backUpSkill, readSkill, skillHash, validSkillName, validateSkill } from "./skill-files"
import { applySkills, outsideEdits } from "./skills"
import { type LocalState, deviceName, loadState, saveState } from "./state"
import { type Locations, findTool, instructionsFile, skillsDir } from "./tools"

const CHECK_INTERVAL = 5_000
const FULL_CHECK_TICKS = 12

export type HarnessSyncDeps = {
  locations: Locations
  dataDir: string
  pickNewFile: () => Promise<string | undefined>
  pickExistingFile: () => Promise<string | undefined>
  changed: (notice?: { from: string; tools: number; skills: number }) => void
}

export function createHarnessSync(deps: HarnessSyncDeps) {
  const statePath = path.join(deps.dataDir, "state.json")
  const backups = path.join(deps.dataDir, "backups")
  const runtime: { lastError?: string; stateWarning?: string; lastChecked?: string; pending?: string } = {}
  let queue: Promise<unknown> = Promise.resolve()
  const gate = <T>(work: () => Promise<T>) => {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }

  const local = async () => {
    const loaded = await loadState(statePath)
    if (loaded.warning) runtime.stateWarning = loaded.warning
    return loaded.state
  }

  async function refresh(write: Write): Promise<HarnessSyncStatus> {
    const state = await local()
    const loaded = state.syncFile
      ? await load(state.syncFile).then(
          (value) => ({ value }),
          (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
        )
      : undefined
    const document = loaded && "value" in loaded ? loaded.value.document : undefined
    runtime.lastError = loaded && "error" in loaded ? loaded.error : undefined
    const tools = await applyInstructions(document, deps.locations, state, write)
    const skills = await applySkills(document, deps.locations, state, write, backups)
    if (write !== "never" && loaded && "value" in loaded) state.lastFileHash = loaded.value.hash
    await saveState(statePath, state)
    runtime.lastChecked = nowRfc3339()
    const pending = runtime.pending
      ? await load(runtime.pending).then(
          (value) => ({
            name: path.basename(runtime.pending!),
            updatedBy: value.document.updatedBy,
            updatedAt: value.document.updatedAt,
          }),
          () => undefined,
        )
      : undefined
    return {
      deviceName: deviceName(state),
      ...(state.syncFile
        ? {
            syncFile: {
              path: state.syncFile,
              name: path.basename(state.syncFile),
              conflictCopies: await conflictCopies(state.syncFile),
            },
          }
        : {}),
      ...(document
        ? {
            document: {
              revision: document.revision,
              updatedAt: document.updatedAt,
              updatedBy: document.updatedBy,
              shared: document.shared,
              tools: document.tools,
              sharedSkills: document.sharedSkills,
            },
          }
        : {}),
      ...(runtime.lastError ? { error: runtime.lastError } : {}),
      ...(runtime.stateWarning ? { warning: runtime.stateWarning } : {}),
      lastChecked: runtime.lastChecked,
      ...(pending ? { pending } : {}),
      tools,
      skills,
    }
  }

  async function readSkillSources(presets: HarnessSyncPresets) {
    const entries = await Promise.all(
      Object.entries(presets.skillSources).map(async ([name, tool]) => {
        if (!tool || !findTool(tool)) throw new Error("Unknown harness")
        if (!validSkillName(name)) throw new Error(`"${name}" is not a valid skill name`)
        const dir = path.join(skillsDir(deps.locations, tool), name)
        const skill = await readSkill(dir).catch((error: unknown) => {
          throw new Error(`${dir} ${error instanceof Error ? error.message : String(error)}`)
        })
        if (!skill) throw new Error(`${dir} was not found`)
        validateSkill(name, skill)
        return [name, skill] as const
      }),
    )
    return Object.fromEntries(entries)
  }

  async function uploadOutsideEdits(seen?: Map<string, string>) {
    const state = await local()
    if (!state.syncFile) {
      seen?.clear()
      return false
    }
    const file = state.syncFile
    const loaded = await load(file).catch(() => undefined)
    if (!loaded) return false
    const document = loaded.document
    const found = await outsideEdits(document, deps.locations, state)
    const previous = seen ? new Map(seen) : undefined
    if (seen) {
      seen.clear()
      Object.entries(found).forEach(([name, skill]) => seen.set(name, skillHash(skill)))
    }
    const stable = Object.entries(found).filter(([name, skill]) => !previous || previous.get(name) === skillHash(skill))
    const backedUp = await Promise.all(
      stable.map(async ([name, skill]) => {
        const old = document.skills[name]
        if (!old) return undefined
        const saved = await backUpSkill(backups, "library", name, old).then(
          () => true,
          () => false,
        )
        return saved ? ([name, skill] as const) : undefined
      }),
    )
    const edits: Record<string, Skill> = Object.fromEntries(backedUp.filter((item) => item !== undefined))
    if (Object.keys(edits).length === 0) return false
    return save(
      file,
      document.revision,
      { shared: document.shared, tools: document.tools, sharedSkills: document.sharedSkills },
      edits,
      deviceName(state),
    ).then(
      () => true,
      () => false,
    )
  }

  async function applyForUser() {
    await uploadOutsideEdits()
    return refresh("always")
  }

  async function connect(file: string) {
    const state = await local()
    await saveState(statePath, { ...state, syncFile: file, lastFileHash: undefined })
    return refresh("always")
  }

  async function useThisComputer(file: string, seed: HarnessSyncToolID, expectedRevision?: number) {
    const current = (await load(file)).document
    const presets = await capture(current, deps.locations, seed)
    await save(file, expectedRevision ?? current.revision, presets, {}, deviceName(await local()))
  }

  const tool = (value: unknown) => {
    const found = findTool(value)
    if (!found) throw new Error("Unknown harness")
    return found.id
  }

  const worker = {
    first: true,
    tick: 0,
    stamp: undefined as string | undefined,
    tried: undefined as string | undefined,
    seen: new Map<string, string>(),
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    stopped: false,
  }

  async function check() {
    const state = await local()
    const file = state.syncFile
    if (!file) {
      worker.stamp = undefined
      return undefined
    }
    const full = worker.tick % FULL_CHECK_TICKS === 0
    if (full) await uploadOutsideEdits(worker.seen)
    const stamp = await lstat(file).then(
      (info) => `${info.size}:${info.mtimeMs}`,
      () => undefined,
    )
    if (!full && stamp !== undefined && stamp === worker.stamp) return undefined
    worker.stamp = undefined
    const read = await readHash(file).then(
      (value) => ({ value }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    )
    const changed =
      "value" in read
        ? worker.first ||
          (worker.tried !== read.value && (runtime.lastError !== undefined || state.lastFileHash !== read.value))
        : runtime.lastError !== read.error
    const status = changed ? await refresh("keepOutsideEdits") : undefined
    worker.tried = "value" in read ? read.value : undefined
    if (runtime.lastError === undefined) worker.stamp = stamp
    return status
  }

  function schedule() {
    if (worker.stopped) return
    worker.timer = setTimeout(
      async () => {
        const status = await gate(check).catch(() => undefined)
        worker.first = false
        worker.tick += 1
        if (status) {
          const tools = status.tools.filter((item) => item.state === "updated").length
          const skills = new Set(
            status.skills.tools.flatMap((item) => item.skills.filter((s) => s.state === "updated").map((s) => s.name)),
          ).size
          const remote = status.document && status.document.updatedBy !== status.deviceName && tools + skills > 0
          deps.changed(remote ? { from: status.document!.updatedBy, tools, skills } : undefined)
        }
        schedule()
      },
      worker.timer === undefined ? 0 : CHECK_INTERVAL,
    )
    worker.timer.unref?.()
  }

  return {
    start: schedule,
    testing: {
      upload: (seen: Map<string, string>) => gate(() => uploadOutsideEdits(seen)),
      refresh: (write: Write) => gate(() => refresh(write)),
    },
    stop() {
      worker.stopped = true
      clearTimeout(worker.timer)
    },
    status: () => gate(() => refresh("never")),
    syncNow: () => gate(applyForUser),
    async readToolInstructions(id: unknown) {
      const file = instructionsFile(deps.locations, tool(id))
      return (
        (await readText(file).catch((error: unknown) => {
          throw new Error(`${file} ${error instanceof Error ? error.message : String(error)}`)
        })) ?? ""
      )
    },
    async createSyncFile(seed: unknown) {
      const seedTool = seed === undefined || seed === null ? undefined : tool(seed)
      const file = await deps.pickNewFile()
      if (!file) return null
      const shared = seedTool ? await readText(instructionsFile(deps.locations, seedTool)).then((t) => t ?? "") : ""
      return gate(async () => {
        await create(file, shared, deviceName(await local()))
        return connect(file)
      })
    },
    async openSyncFile() {
      const file = await deps.pickExistingFile()
      if (!file) return null
      await load(file)
      return gate(() => {
        runtime.pending = file
        return refresh("never")
      })
    },
    join: (seed: unknown) =>
      gate(async () => {
        const file = runtime.pending
        if (!file) throw new Error("Choose a sync file first")
        if (seed !== undefined && seed !== null) await useThisComputer(file, tool(seed))
        runtime.pending = undefined
        return connect(file)
      }),
    cancelJoin: () =>
      gate(() => {
        runtime.pending = undefined
        return refresh("never")
      }),
    useThisComputer: (seed: unknown, expectedRevision: unknown) =>
      gate(async () => {
        const file = (await local()).syncFile
        if (!file) throw new Error("Connect a sync file first")
        if (typeof expectedRevision !== "number") throw new Error("The revision is missing")
        await useThisComputer(file, tool(seed), expectedRevision)
        return refresh("always")
      }),
    disconnect: () =>
      gate(async () => {
        const state = await local()
        await saveState(statePath, { ...state, syncFile: undefined, lastFileHash: undefined } satisfies LocalState)
        return refresh("never")
      }),
    save: (value: unknown, expectedRevision: unknown) =>
      gate(async () => {
        const presets = parsePresets(value)
        if (typeof expectedRevision !== "number") throw new Error("The revision is missing")
        const state = await local()
        if (!state.syncFile) throw new Error("Connect a sync file first")
        const uploads = await readSkillSources(presets)
        await save(state.syncFile, expectedRevision, presets, uploads, deviceName(state))
        return applyForUser()
      }),
    setDeviceName: (value: unknown) =>
      gate(async () => {
        const name = typeof value === "string" ? value.trim() : ""
        if (!name || [...name].length > 64) throw new Error("Use a name between 1 and 64 characters")
        await saveState(statePath, { ...(await local()), deviceName: name })
        return refresh("never")
      }),
  }
}

export type HarnessSyncService = ReturnType<typeof createHarnessSync>
