import { describe, expect, test } from "bun:test"
import { testEndpoints } from "./endpoints"

describe("thread sync test endpoints", () => {
  const env = {
    TENON_THREAD_SYNC_OAUTH_ENDPOINT: "http://127.0.0.1:4400/",
    TENON_THREAD_SYNC_DRIVE_ENDPOINT: "http://localhost:4401",
  }

  test("an unpackaged build points sign-in and Drive at loopback fakes", () => {
    expect(testEndpoints(env, false)).toEqual({
      oauth: {
        authorize: "http://127.0.0.1:4400/authorize",
        token: "http://127.0.0.1:4400/token",
        revoke: "http://127.0.0.1:4400/revoke",
      },
      drive: "http://localhost:4401",
    })
  })

  test("a packaged build ignores both", () => {
    expect(testEndpoints(env, true)).toBeUndefined()
  })

  test("anything but plain http on loopback is ignored", () => {
    for (const value of ["https://127.0.0.1:4400", "http://192.168.1.5:4400", "http://example.com", "not a url"])
      expect(
        testEndpoints({ TENON_THREAD_SYNC_OAUTH_ENDPOINT: value, TENON_THREAD_SYNC_DRIVE_ENDPOINT: value }, false),
      ).toBeUndefined()
  })
})
