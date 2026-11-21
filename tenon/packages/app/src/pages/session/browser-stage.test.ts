import { describe, expect, test } from "bun:test"
import { browserStage } from "./browser-stage"

const page = (input: Partial<Parameters<typeof browserStage>[0]> = {}) => ({
  url: "",
  loading: false,
  error: undefined,
  ...input,
})

describe("AC-5 the Browser tab never shows a blank native view", () => {
  test("a fresh tab shows the start state, not the native view", () => {
    expect(browserStage(page())).toBe("empty")
  })

  test("a first navigation in flight shows loading", () => {
    expect(browserStage(page({ loading: true }))).toBe("loading")
  })

  test("a failure shows the error, even though the view has an address", () => {
    expect(
      browserStage(
        page({
          url: "https://example.com/",
          error: { kind: "load", code: -106, description: "x", url: "https://example.com/" },
        }),
      ),
    ).toBe("error")
  })

  test("a committed page shows the native view, also while the next page loads", () => {
    expect(browserStage(page({ url: "https://example.com/" }))).toBe("page")
    expect(browserStage(page({ url: "https://example.com/", loading: true }))).toBe("page")
  })

  test("about:blank counts as no page", () => {
    expect(browserStage(page({ url: "about:blank" }))).toBe("empty")
  })
})
