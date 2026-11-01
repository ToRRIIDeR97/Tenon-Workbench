export * as File from "./file"

import { Revert } from "@tenon/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
