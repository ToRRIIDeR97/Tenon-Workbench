import { Schema } from "effect"

export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export const toolError = (message: string, cause?: unknown): ToolError =>
  new ToolError({ message, ...(cause === undefined ? {} : { cause }) })
