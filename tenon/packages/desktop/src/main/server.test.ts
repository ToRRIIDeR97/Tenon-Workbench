import { describe, expect, mock, test } from "bun:test"

// Mocks are process-wide in bun, so this keeps the exports other test files' Electron mocks provide.
mock.module("electron", () => ({
  default: {},
  net: {},
  protocol: {},
  app: { getPath: () => "", isPackaged: false, on: () => {}, off: () => {} },
  crashReporter: {},
  shell: {},
  utilityProcess: {},
}))
const { createSidecarEnv } = await import("./server")

describe("createSidecarEnv", () => {
  test("adds the bridge env to the server's env without writing it to the base env", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin", DEBUG: "1", LD_PRELOAD: "x.so", EMPTY: undefined }
    const bridge = {
      TENON_BROWSER_URL: "http://127.0.0.1:1",
      TENON_BROWSER_TOKEN: "browser-token",
      TENON_MAIL_URL: "http://127.0.0.1:2",
      TENON_MAIL_TOKEN: "mail-token",
    }

    expect(createSidecarEnv(base, bridge, "linux")).toEqual({ PATH: "/usr/bin", ...bridge })
    expect(base).toEqual({ PATH: "/usr/bin", DEBUG: "1", LD_PRELOAD: "x.so", EMPTY: undefined })
  })

  test("keeps LD_PRELOAD outside Linux", () => {
    expect(createSidecarEnv({ LD_PRELOAD: "x.so" }, {}, "darwin")).toEqual({ LD_PRELOAD: "x.so" })
    expect(createSidecarEnv({ LD_PRELOAD: "x.so" }, {}, "win32")).toEqual({ LD_PRELOAD: "x.so" })
  })
})
