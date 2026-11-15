import { describe, expect, test } from "bun:test"
import { permissionSummary } from "./permission-summary"

describe("permissionSummary", () => {
  // A Codex MCP tool call is approved per server (harness.ts, mcpServer/elicitation/request).
  test("names an MCP tool approval", () => {
    expect(permissionSummary({ permission: "mcp", patterns: ["tenoncheck"] }).key).toBe("secondBrain.permission.mcp")
  })

  test("names the kind and counts what it covers", () => {
    expect(permissionSummary({ permission: "bash", patterns: ["ls", "pwd", "git status"] })).toEqual({
      key: "secondBrain.permission.bash",
      count: 3,
      tool: "bash",
      risky: false,
    })
  })

  test("outside-folder requests are risky; unknown tools get the generic line", () => {
    expect(permissionSummary({ permission: "external_directory", patterns: ["/etc/*"] }).risky).toBe(true)
    expect(permissionSummary({ permission: "acp_tool", patterns: [] })).toMatchObject({
      key: "secondBrain.permission.other",
      count: 1,
      tool: "acp tool",
    })
  })
})
