import { randomUUID } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"

export const marker = ".user-data-migrated"

const skip = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
  "logs",
  "cli",
  "DevToolsActivePort",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
])

export function migrateUserData(from: string | undefined, to: string, move = renameSync) {
  if (existsSync(join(to, marker))) return "done"
  if (!from || !existsSync(from)) return finish(from, to, "absent")
  const source = realpathSync(from)
  const temp = `${to}.migrating-${randomUUID()}`
  mkdirSync(dirname(to), { recursive: true })
  for (const name of readdirSync(dirname(to))) {
    if (name.startsWith(`${basename(to)}.migrating-`)) rmSync(join(dirname(to), name), { recursive: true, force: true })
  }
  try {
    cpSync(source, temp, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => !skip.has(relative(source, path).split(sep)[0]),
    })
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    throw error
  }
  if (!rename(temp, to, move)) {
    const failed = moveMissing(temp, to, move)
    if (failed.length > 0) throw new Error(`could not move ${failed.join(", ")} into the new user data folder`)
  }
  rmSync(temp, { recursive: true, force: true })
  return finish(from, to, "copied")
}

function finish(from: string | undefined, to: string, result: "copied" | "absent") {
  mkdirSync(to, { recursive: true })
  writeFileSync(join(to, marker), `${JSON.stringify({ from, result })}\n`)
  return result
}

function moveMissing(source: string, target: string, move: typeof renameSync, prefix = ""): string[] {
  mkdirSync(target, { recursive: true })
  return readdirSync(source, { withFileTypes: true }).flatMap((entry) => {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    const name = `${prefix}${entry.name}`
    if (!existsSync(to)) return rename(from, to, move) ? [] : [name]
    if (entry.isDirectory() && statSync(to).isDirectory()) return moveMissing(from, to, move, `${name}/`)
    return []
  })
}

function rename(from: string, to: string, move: typeof renameSync) {
  try {
    move(from, to)
    return true
  } catch {
    return false
  }
}
