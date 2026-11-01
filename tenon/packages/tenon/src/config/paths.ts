export * as ConfigPaths from "./paths"

import { ConfigNames } from "@tenon/core/config/names"
import path from "path"
import { Flag } from "@tenon/core/flag/flag"
import { Global } from "@tenon/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@tenon/core/fs-util"

/** Project config files for `names` (lowest priority first), ordered so later files win when merged. */
export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  names: readonly string[],
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: names.toReversed().flatMap((name) => [`${name}.jsonc`, `${name}.json`]),
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.TENON_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [...ConfigNames.directories],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [...ConfigNames.directories],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.TENON_CONFIG_DIR ? [Flag.TENON_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
