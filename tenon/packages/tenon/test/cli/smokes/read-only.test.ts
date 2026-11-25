import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"

describe("opencode read-only commands (smoke)", () => {
  cliIt.live(
    "mcp list: exits 0",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["mcp", "list"])
        opencode.expectExit(r, 0, "mcp list")
      }),
    60_000,
  )

  cliIt.live(
    "providers list: exits 0 and prints the credentials section",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["providers", "list"])
        opencode.expectExit(r, 0, "providers list")
        expect(r.stdout).toContain("Credentials")
      }),
    60_000,
  )

  cliIt.live(
    "models: exits 0 and lists the test model",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["models"])
        opencode.expectExit(r, 0, "models")
        expect(r.stdout).toContain("test/test-model")
      }),
    60_000,
  )

  cliIt.live(
    "agent list: exits 0",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["agent", "list"])
        opencode.expectExit(r, 0, "agent list")
      }),
    60_000,
  )

  cliIt.live(
    "session list: exits 0",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["session", "list"])
        opencode.expectExit(r, 0, "session list")
      }),
    60_000,
  )

  cliIt.live(
    "db path: exits 0 and prints a path or :memory:",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["db", "path"])
        opencode.expectExit(r, 0, "db path")
        expect(r.stdout.trim()).toMatch(/^(:memory:|[/\\].+\.(db|sqlite|sqlite3))$/i)
      }),
    60_000,
  )
})
