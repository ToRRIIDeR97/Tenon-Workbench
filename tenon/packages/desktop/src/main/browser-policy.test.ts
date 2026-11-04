import { expect, test } from "bun:test"
import { isBlockedRequest, needsAgentConsent } from "./browser-policy"

test("the app server's port is blocked under every loopback name, and only there", () => {
  const blocked = new Set(["http://127.0.0.1:4096"])
  for (const url of [
    "http://127.0.0.1:4096/session",
    "http://localhost:4096/",
    "http://app.localhost:4096/",
    "http://[::1]:4096/",
    "http://0.0.0.0:4096/",
    "http://localhost.:4096/",
    "http://[::ffff:127.0.0.1]:4096/",
  ])
    expect(isBlockedRequest(new URL(url), blocked)).toBe(true)
  expect(isBlockedRequest(new URL("http://localhost:3000/"), blocked)).toBe(false)
  expect(isBlockedRequest(new URL("http://example.com:4096/"), blocked)).toBe(false)
})

test("page-driven navigation needs consent only during an agent call, for a new remote host", () => {
  const remote = new URL("https://example.com/a")
  expect(needsAgentConsent(remote, 1, new Set())).toBe(true)
  expect(needsAgentConsent(remote, 0, new Set())).toBe(false)
  expect(needsAgentConsent(remote, 1, new Set(["example.com"]))).toBe(false)
  expect(needsAgentConsent(new URL("http://localhost:3000/"), 1, new Set())).toBe(false)
})
