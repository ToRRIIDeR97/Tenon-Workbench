export * as ConfigCommand from "./command"

import path from "path"
import { Cause, Exit, Schema } from "effect"
import { Glob } from "@tenon/core/util/glob"
import { ConfigCommandV1 } from "@tenon/core/v1/config/command"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "@tenon/core/v1/config/error"
import * as ConfigMarkdown from "./markdown"
import { withInputOrder } from "@tenon/core/util/input-order"

const decodeInfo = Schema.decodeUnknownExit(ConfigCommandV1.Info)

export async function load(dir: string) {
  const result: Record<string, ConfigCommandV1.Info> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["command/", "commands/"])

    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = decodeInfo(config, { errors: "all" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = withInputOrder(config, parsed.value)
      continue
    }
    throw new InvalidError({ path: item, message: Cause.pretty(parsed.cause) }, { cause: Cause.squash(parsed.cause) })
  }
  return result
}
