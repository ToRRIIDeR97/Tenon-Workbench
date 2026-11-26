import fs from "fs/promises"
import path from "path"
import { tmpdir } from "./tmpdir"

const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? String(error.code) : String(error)

export const probeSymlinkRefusal = async () => {
  await using dir = await tmpdir()
  const target = path.join(dir.path, "target.txt")
  await fs.writeFile(target, "")
  return fs.symlink(target, path.join(dir.path, "link")).then(
    () => undefined,
    (error: unknown) => errorCode(error),
  )
}

export const symlinkRefusal = await probeSymlinkRefusal()

export const reportSymlinkSkip = (suite: string) => {
  if (!symlinkRefusal) return false
  console.warn(
    `${suite}: skipping symlink tests because the operating system refused to create a symlink (${symlinkRefusal})`,
  )
  return true
}
