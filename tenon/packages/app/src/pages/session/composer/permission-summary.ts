import type { PermissionRequest } from "@opencode-ai/sdk/v2"

const KEYS = {
  bash: "secondBrain.permission.bash",
  edit: "secondBrain.permission.edit",
  read: "secondBrain.permission.read",
  webfetch: "secondBrain.permission.webfetch",
  mcp: "secondBrain.permission.mcp",
  external_directory: "secondBrain.permission.external",
} as const

/**
 * The one-line headline for an approval: its kind and how many commands, files or addresses it covers.
 * Reaching outside the folder is the risky kind, shown in the warning tone without an "always" choice.
 */
export function permissionSummary(request: Pick<PermissionRequest, "permission" | "patterns">) {
  const kind = request.permission as keyof typeof KEYS
  return {
    key: KEYS[kind] ?? ("secondBrain.permission.other" as const),
    count: Math.max(1, request.patterns.length),
    tool: request.permission.replaceAll("_", " "),
    risky: request.permission === "external_directory",
  }
}
