import { describe, expect, test } from "bun:test"
import { approvalQueue } from "../../../../tenon/packages/app/src/features/command-centre/approval-queue"

const threads = [
  { id: "ses_a", title: "Fix e2e", project: "Tenon" },
  { id: "ses_b", title: "Capstone report", project: "Capstone" },
]

describe("AC-2.1 approval queue", () => {
  test("AC-2.1 lists every pending approval and question of the given threads, oldest first", () => {
    const queue = approvalQueue(threads, {
      permission: { ses_a: [{ id: "per_1", time: { created: 300 } }] },
      question: { ses_b: [{ id: "que_1", time: { created: 100 } }], ses_a: [{ id: "que_2", time: { created: 200 } }] },
    })
    expect(queue).toEqual([
      { kind: "question", sessionID: "ses_b", requestID: "que_1", title: "Capstone report", project: "Capstone", asked: 100 },
      { kind: "question", sessionID: "ses_a", requestID: "que_2", title: "Fix e2e", project: "Tenon", asked: 200 },
      { kind: "permission", sessionID: "ses_a", requestID: "per_1", title: "Fix e2e", project: "Tenon", asked: 300 },
    ])
  })

  test("AC-2.1 ignores requests of threads that were not given", () => {
    const queue = approvalQueue(threads, {
      permission: { ses_other: [{ id: "per_9", time: { created: 1 } }] },
      question: {},
    })
    expect(queue).toEqual([])
  })

  test("AC-2.1 on a tie a permission comes before a question", () => {
    const queue = approvalQueue(threads, {
      permission: { ses_b: [{ id: "per_1", time: { created: 50 } }] },
      question: { ses_a: [{ id: "que_1", time: { created: 50 } }] },
    })
    expect(queue.map((item) => item.kind)).toEqual(["permission", "question"])
  })
})
