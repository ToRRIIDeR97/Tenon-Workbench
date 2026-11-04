import { afterAll, expect, test } from "bun:test"
import { HarnessBrowserTools } from "../src/harness/browser-tools"

const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) })
process.env[HarnessBrowserTools.URL_ENV] = `http://127.0.0.1:${server.port}`
process.env[HarnessBrowserTools.TOKEN_ENV] = "test"

afterAll(() => {
  delete process.env[HarnessBrowserTools.URL_ENV]
  delete process.env[HarnessBrowserTools.TOKEN_ENV]
  void server.stop(true)
})

test("a tool past its time says it is still running, not that the request aborted", async () => {
  await expect(HarnessBrowserTools.call("device_install", {}, "ses_1", 0.05)).rejects.toThrow(
    "device_install is still running after 0.05 seconds.",
  )
})
