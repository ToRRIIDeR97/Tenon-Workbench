import { describe, expect, test } from "bun:test"
import path from "path"
import { Config } from "@tenon/core/config"
import { HarnessForwardedMcp } from "@tenon/core/harness/forwarded-mcp"

const doc = (mcp: unknown) => ({ type: "document", info: { mcp } }) as unknown as Config.Entry

// Settings › MCP servers reach the external harnesses: Codex as `-c` overrides, ACP agents in session/new.
describe("forwarded MCP servers", () => {
  const entries = [
    doc({ servers: { docs: { type: "local", command: ["npx", "docs-mcp"] }, old: { type: "local", command: ["a"] } } }),
    { type: "directory", path: "/x" } as unknown as Config.Entry,
    doc({
      servers: {
        old: { type: "local", command: ["a"], disabled: true },
        search: { type: "remote", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer s3cret" } },
        db: {
          type: "local",
          command: ["db-mcp", "--ro"],
          cwd: "tools",
          environment: { DB_URL: "postgres://u:p@h/db" },
        },
        tenon: { type: "local", command: ["fake"] },
        "bad name": { type: "local", command: ["x"] },
      },
    }),
  ]

  test("later documents win; switched-off, reserved and unsafe names are left out", () => {
    expect(HarnessForwardedMcp.servers(entries).map(([name]) => name)).toEqual(["docs", "search", "db"])
  })

  test("Codex gets overrides without secrets on the command line", () => {
    const dir = path.resolve("/work")
    const { args, env } = HarnessForwardedMcp.codex(HarnessForwardedMcp.servers(entries), dir)
    const values = args.filter((_, index) => index % 2 === 1)
    expect(values).toEqual([
      'mcp_servers.docs.command="npx"',
      'mcp_servers.docs.args=["docs-mcp"]',
      'mcp_servers.search.url="https://mcp.example.com/mcp"',
      'mcp_servers.search.env_http_headers={ "Authorization" = "TENON_MCP_1_AUTHORIZATION" }',
      'mcp_servers.db.command="db-mcp"',
      'mcp_servers.db.args=["--ro"]',
      `mcp_servers.db.cwd=${JSON.stringify(path.resolve(dir, "tools"))}`,
      'mcp_servers.db.env_vars=["DB_URL"]',
    ])
    expect(args.join(" ")).not.toContain("s3cret")
    expect(args.join(" ")).not.toContain("postgres://")
    expect(env).toEqual({ TENON_MCP_1_AUTHORIZATION: "Bearer s3cret", DB_URL: "postgres://u:p@h/db" })
  })

  test("ACP agents get stdio entries without a type and HTTP entries with headers", () => {
    expect(HarnessForwardedMcp.acp(HarnessForwardedMcp.servers(entries))).toEqual([
      { name: "docs", command: "npx", args: ["docs-mcp"], env: [] },
      {
        type: "http",
        name: "search",
        url: "https://mcp.example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer s3cret" }],
      },
      { name: "db", command: "db-mcp", args: ["--ro"], env: [{ name: "DB_URL", value: "postgres://u:p@h/db" }] },
    ])
  })
})
