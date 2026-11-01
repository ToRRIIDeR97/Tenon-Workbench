import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@tenon/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~tenon/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~tenon/WorkspaceRef", {
  defaultValue: () => undefined,
})
