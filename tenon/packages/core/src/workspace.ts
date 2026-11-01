export * as WorkspaceV2 from "./workspace"

import { Workspace } from "@tenon/schema/workspace"

export const ID = Workspace.ID
export type ID = typeof ID.Type
