import { LocalContext } from "@/util/local-context"
import { FSUtil } from "@tenon/core/fs-util"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (FSUtil.contains(ctx.directory, filepath)) return true
  if (ctx.worktree === "/") return false
  return FSUtil.contains(ctx.worktree, filepath)
}
