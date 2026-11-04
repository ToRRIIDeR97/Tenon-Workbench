import { expect, test } from "bun:test"
import type { Resource } from "solid-js"
import { settled } from "./resource"

const resource = (state: Resource<string>["state"]) =>
  ({
    state,
    get latest() {
      if (state === "ready" || state === "refreshing") return "value"
      throw new Error("a read would suspend or throw")
    },
  }) as Resource<string>

test("settled reads a resource only once it has a value", () => {
  expect(settled(resource("ready"))).toBe("value")
  expect(settled(resource("refreshing"))).toBe("value")
  expect(settled(resource("unresolved"))).toBeUndefined()
  expect(settled(resource("pending"))).toBeUndefined()
  expect(settled(resource("errored"))).toBeUndefined()
})
