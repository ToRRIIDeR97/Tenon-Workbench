import { describe, expect, test } from "bun:test"
import { asksUser, finishMark } from "./thread-finish"

// Acceptance tests for implementations/harness-ux-batch-2 (AC-5): a finished thread says whether it is done or
// waiting on the user.

describe("AC-5 asksUser", () => {
  test("a reply that ends by asking something asks the user", () => {
    expect(asksUser("I found two options.\n\nWhich one do you want?")).toBe(true)
    expect(asksUser("Done with the refactor. Should I also update the docs?\n")).toBe(true)
  })

  test("a reply that ends with a statement does not", () => {
    expect(asksUser("Fixed the bug and the tests pass.")).toBe(false)
    expect(asksUser("")).toBe(false)
  })
})

describe("AC-5 finishMark", () => {
  test("an unseen failure, question and finished turn each have their own mark", () => {
    expect(finishMark({ unseen: 1, error: true, asks: true })).toBe("failed")
    expect(finishMark({ unseen: 1, error: false, asks: true })).toBe("reply")
    expect(finishMark({ unseen: 2, error: false, asks: false })).toBe("done")
  })

  test("nothing unseen shows no mark", () => {
    expect(finishMark({ unseen: 0, error: false, asks: false })).toBeUndefined()
  })
})
