import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { cliIt } from "../../lib/cli-process"

describe("opencode serve (subprocess)", () => {
  cliIt.live(
    "starts, binds a port, and serves /global/health",
    ({ opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/global/health`)
        expect(res.status).toBe(200)
        const body = yield* res.json
        expect(body).toBeDefined()
      }),
    60_000,
  )
})
