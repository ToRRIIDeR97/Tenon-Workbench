import whichPkg from "which"
import { lstatSync, statSync } from "fs"
import path from "path"
import { Global } from "../global"

const isFile = (file: string) => {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false
  } catch {
    try {
      return lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ?? false
    } catch {
      return false
    }
  }
}

const envValue = (env: NodeJS.ProcessEnv, name: string) =>
  env[Object.keys(env).find((key) => key.toUpperCase() === name) ?? name]

const isBare = (cmd: string) => !/[\\/]/.test(cmd) && !/^[a-z]:/i.test(cmd)

export function resolveWin32(cmd: string, env: NodeJS.ProcessEnv, exists = isFile) {
  const dirs = (envValue(env, "PATH") ?? envValue(process.env, "PATH") ?? "")
    .split(";")
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter((dir) => /^([a-z]:[\\/]|\\\\)/i.test(dir))
  const exts = (envValue(env, "PATHEXT") ?? envValue(process.env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
  const names = [...(cmd.includes(".") ? [cmd] : []), ...exts.map((ext) => cmd + ext)]
  return (
    dirs.flatMap((dir) => names.map((name) => path.win32.join(dir, name))).find((candidate) => exists(candidate)) ??
    null
  )
}

export function spawnTarget(cmd: string, env: NodeJS.ProcessEnv = process.env) {
  if (process.platform !== "win32" || !isBare(cmd)) return cmd
  return resolveWin32(cmd, env)
}

export function notFound(cmd: string) {
  return Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT", syscall: `spawn ${cmd}`, path: cmd })
}

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base ? base + path.delimiter + Global.Path.bin : Global.Path.bin
  const pathExt = env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt
  if (process.platform === "win32" && isBare(cmd)) return resolveWin32(cmd, { PATH: full, PATHEXT: pathExt })
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt,
  })
  return typeof result === "string" ? result : null
}
