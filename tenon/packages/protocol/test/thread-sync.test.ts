import { describe, expect, test } from "bun:test"
import { ThreadSyncCode, threadSyncFailure } from "../src/groups/thread-sync"

const expected: Record<ThreadSyncCode, number> = {
  invalid_name: 400,
  not_found: 404,
  conflict: 409,
  not_owner: 409,
  diverged: 409,
  not_ready: 412,
  invalid_key: 422,
  invalid_segment: 422,
  unreadable: 422,
  unsupported: 422,
  foreign_path: 422,
  unavailable: 502,
  unauthorized: 502,
}

const statusOf = (failure: object): unknown =>
  (failure.constructor as unknown as { ast?: { annotations?: Record<string, unknown> } }).ast?.annotations
    ?.httpApiStatus

describe("thread sync errors", () => {
  test("every code has a status and keeps its code and message", () => {
    const answered = ThreadSyncCode.literals.map((code) => {
      const failure = threadSyncFailure({ code, message: `about ${code}` })
      return [failure.code, failure.message, statusOf(failure)]
    })
    expect(answered).toEqual(ThreadSyncCode.literals.map((code) => [code, `about ${code}`, expected[code]]))
  })
})
