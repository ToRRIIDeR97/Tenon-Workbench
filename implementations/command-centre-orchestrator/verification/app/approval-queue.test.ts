import { describe, expect, test } from "bun:test"
import { approvalQueue } from "../../../../tenon/packages/app/src/features/command-centre/approval-queue"

const threads = [
  { id: "t1", title: "One", project: "P" },
  { id: "t2", title: "Two", project: "Q" },
]

describe("AC-2.1 boundaries", () => {
  test("AC-2.1 nothing pending gives an empty queue, including missing and empty entries", () => {
    expect(approvalQueue(threads, { permission: {}, question: {} })).toEqual([])
    expect(approvalQueue(threads, { permission: { t1: undefined, t2: [] }, question: { t1: [] } })).toEqual([])
    expect(approvalQueue([], { permission: { t1: [{ id: "a" }] }, question: {} })).toEqual([])
  })

  test("AC-2.1 a request without a time counts as asked at 0 and so comes first", () => {
    const queue = approvalQueue(threads, {
      permission: { t1: [{ id: "timed", time: { created: 5 } }, { id: "untimed" }] },
      question: { t2: [{ id: "empty-time", time: {} }] },
    })
    expect(queue.map((item) => [item.requestID, item.asked])).toEqual([
      ["untimed", 0],
      ["empty-time", 0],
      ["timed", 5],
    ])
  })

  test("AC-2.1 several requests of one thread are all listed, in input order on ties", () => {
    const queue = approvalQueue(threads, {
      permission: { t2: [{ id: "x", time: { created: 9 } }, { id: "y", time: { created: 9 } }], t1: [{ id: "w", time: { created: 9 } }] },
      question: {},
    })
    expect(queue.map((item) => item.requestID)).toEqual(["w", "x", "y"])
    expect(queue.every((item) => item.kind === "permission")).toBe(true)
  })

  test("AC-2.1 the input is not changed", () => {
    const data = {
      permission: { t1: [{ id: "b", time: { created: 2 } }, { id: "a", time: { created: 1 } }] },
      question: {},
    }
    const copy = structuredClone(data)
    approvalQueue(threads, data)
    expect(data).toEqual(copy)
  })
})
