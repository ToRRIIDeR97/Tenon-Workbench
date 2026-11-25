export * as LegacyStorage from "./legacy-storage"

import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"

export interface Root {
  readonly from: string
  readonly to: string
  readonly skip: ReadonlyArray<string>
}

export type Result = "copied" | "done" | "absent"

export const marker = ".legacy-storage-migrated"

export function migrate(roots: ReadonlyArray<Root>) {
  return Promise.all(roots.map(copyRoot))
}

async function copyRoot(root: Root): Promise<Result> {
  if (await exists(path.join(root.to, marker))) return "done"
  if (!(await exists(root.from))) return finish(root, "absent")
  const temp = `${root.to}.migrating-${randomUUID()}`
  const skip = new Set(root.skip)
  const from = await fs.realpath(root.from)
  await fs.mkdir(path.dirname(root.to), { recursive: true })
  try {
    await fs.cp(from, temp, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const relative = path.relative(from, source)
        return !skip.has(relative.split(path.sep)[0]) && !relative.endsWith(".tmp")
      },
    })
    const moved = await fs.rename(temp, root.to).then(
      () => true,
      () => false,
    )
    if (!moved) await moveMissing(temp, root.to)
    return finish(root, "copied")
  } catch (error) {
    throw new Error(
      `Could not copy Tenon Workbench data from ${root.from} to ${root.to}. The original folder is unchanged.`,
      { cause: error },
    )
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

async function finish(root: Root, result: Result) {
  await fs.mkdir(root.to, { recursive: true })
  await fs.writeFile(path.join(root.to, marker), `${JSON.stringify({ from: root.from, result })}\n`)
  return result
}

async function moveMissing(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true })
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (!(await exists(to))) {
      await fs.rename(from, to).catch(() => undefined)
      continue
    }
    if (entry.isDirectory() && (await fs.stat(to)).isDirectory()) await moveMissing(from, to)
  }
}

function exists(target: string) {
  return fs.lstat(target).then(
    () => true,
    () => false,
  )
}
