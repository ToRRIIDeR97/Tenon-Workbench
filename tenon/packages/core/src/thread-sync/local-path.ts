import path from "node:path"

export function canHold(directory: string, platform: NodeJS.Platform = process.platform) {
  if (directory === "") return true
  if (platform === "win32") return path.win32.isAbsolute(directory)
  return path.posix.isAbsolute(directory)
}
