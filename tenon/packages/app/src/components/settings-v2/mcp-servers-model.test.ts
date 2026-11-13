import { describe, expect, test } from "bun:test"
import { mcpEntry, mcpRows, mcpSuggestions } from "./mcp-servers-model"

describe("MCP servers settings", () => {
  test("the form makes a local command or a remote URL", () => {
    expect(mcpEntry("local", " npx -y @scope/server ")).toEqual({
      type: "local",
      command: ["npx", "-y", "@scope/server"],
      enabled: true,
    })
    expect(mcpEntry("remote", "https://mcp.example.com/sse")).toEqual({
      type: "remote",
      url: "https://mcp.example.com/sse",
      enabled: true,
    })
    expect(mcpEntry("remote", "not a url")).toBeUndefined()
    expect(mcpEntry("local", "  ")).toBeUndefined()
  })

  test("rows list configured servers by name with their state", () => {
    const rows = mcpRows({
      zed: { type: "remote", url: "https://z.example", enabled: false },
      alpha: { type: "local", command: ["bunx", "alpha"] },
      toggled: { enabled: true },
    })
    expect(rows.map((row) => [row.name, row.enabled, row.detail])).toEqual([
      ["alpha", true, "bunx alpha"],
      ["zed", false, "https://z.example"],
    ])
  })

  test("suggestions leave out servers already configured by name or by the same command or URL", () => {
    const ids = (config: Parameters<typeof mcpSuggestions>[0]) => mcpSuggestions(config).map((item) => item.id)
    expect(ids(undefined)).toEqual(["playwright", "context7", "github", "linear", "sentry"])
    expect(
      ids({
        github: { enabled: false },
        browser: { type: "local", command: ["npx", "@playwright/mcp@latest"] },
        docs: { type: "remote", url: "https://mcp.context7.com/mcp" },
      }),
    ).toEqual(["linear", "sentry"])
  })
})
