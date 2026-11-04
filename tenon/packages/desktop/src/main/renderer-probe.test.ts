import { expect, test } from "bun:test"
import { answersWithin } from "./renderer-probe"

test("a renderer that answers is not reported as hung", async () => {
  expect(await answersWithin(() => Promise.resolve(true), 50)).toBe(true)
})

test("a renderer that never answers, or fails to, counts as hung", async () => {
  expect(await answersWithin(() => new Promise(() => {}), 5)).toBe(false)
  expect(await answersWithin(() => Promise.reject(new Error("gone")), 50)).toBe(false)
})
