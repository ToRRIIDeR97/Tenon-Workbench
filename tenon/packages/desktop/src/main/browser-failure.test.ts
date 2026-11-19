import { describe, expect, test } from "bun:test"
import { browserCrash, browserLoadFailure } from "./browser-failure"

describe("AC-5 the browser reports why a page didn't load", () => {
  test("a main-frame load failure becomes a readable error with its address", () => {
    expect(
      browserLoadFailure({
        errorCode: -105,
        errorDescription: "ERR_NAME_NOT_RESOLVED",
        validatedURL: "https://no-such-host.invalid/",
        isMainFrame: true,
      }),
    ).toEqual({ kind: "load", code: -105, description: "ERR_NAME_NOT_RESOLVED", url: "https://no-such-host.invalid/" })
  })

  test("an offline load is reported", () => {
    expect(
      browserLoadFailure({
        errorCode: -106,
        errorDescription: "ERR_INTERNET_DISCONNECTED",
        validatedURL: "https://example.com/",
        isMainFrame: true,
      })?.code,
    ).toBe(-106)
  })

  test("an aborted navigation or a failing subframe is not an error", () => {
    expect(
      browserLoadFailure({
        errorCode: -3,
        errorDescription: "ERR_ABORTED",
        validatedURL: "https://example.com/",
        isMainFrame: true,
      }),
    ).toBeUndefined()
    expect(
      browserLoadFailure({
        errorCode: -105,
        errorDescription: "ERR_NAME_NOT_RESOLVED",
        validatedURL: "https://ads.invalid/",
        isMainFrame: false,
      }),
    ).toBeUndefined()
  })

  test("a crashed page process is reported with its reason; a clean exit isn't", () => {
    expect(browserCrash({ reason: "crashed", exitCode: 1 }, "https://example.com/")).toEqual({
      kind: "crashed",
      code: 1,
      description: "crashed",
      url: "https://example.com/",
    })
    expect(browserCrash({ reason: "clean-exit", exitCode: 0 }, "https://example.com/")).toBeUndefined()
  })
})
