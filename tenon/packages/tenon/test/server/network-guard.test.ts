import { expect, test } from "bun:test"
import { ServerNetworkGuard } from "../../src/server/network-guard"

test("an unauthenticated server listens only on loopback", () => {
  for (const hostname of ["127.0.0.1", "localhost", "::1", "127.0.0.2"])
    expect(() => ServerNetworkGuard.assertExposureAllowed(hostname, undefined)).not.toThrow()
  for (const hostname of ["0.0.0.0", "::", "192.168.1.5", "example.local"])
    expect(() => ServerNetworkGuard.assertExposureAllowed(hostname, undefined)).toThrow()
  expect(() => ServerNetworkGuard.assertExposureAllowed("0.0.0.0", "")).toThrow()
})

test("a password allows any hostname", () => {
  expect(() => ServerNetworkGuard.assertExposureAllowed("0.0.0.0", "secret")).not.toThrow()
})

test("a loopback listener answers only loopback Host names and its own hostname", () => {
  for (const host of ["127.0.0.1:4096", "localhost:4096", "LOCALHOST", "[::1]:4096", "127.0.0.2:80", undefined])
    expect(ServerNetworkGuard.isAllowedHost(host, "127.0.0.1")).toBe(true)
  expect(ServerNetworkGuard.isAllowedHost("[::1]:4096", "::1")).toBe(true)
  for (const host of [
    "evil.example:4096",
    "127.0.0.1.nip.io:4096",
    "localhost.evil.example",
    "localhost.",
    "0.0.0.0:4096",
    "[::ffff:7f00:1]:4096",
    "user@evil.example",
    "bad host",
  ])
    expect(ServerNetworkGuard.isAllowedHost(host, "127.0.0.1")).toBe(false)
})
