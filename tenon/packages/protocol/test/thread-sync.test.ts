import { describe, expect, test } from "bun:test"
import { ThreadSyncCode, threadSyncFailure } from "../src/groups/thread-sync"

const expected = {
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
} as const

const statusOf = (failure: object) =>
  (failure.constructor as unknown as { ast?: { annotations?: Record<string, unknown> } }).ast?.annotations
    ?.httpApiStatus

describe("thread sync errors", () => {
  test("every code has a status and keeps its code and message", () => {
    expect(Object.keys(expected).sort()).toEqual([...ThreadSyncCode.literals].sort())
    Object.entries(expected).forEach(([code, status]) => {
      const failure = threadSyncFailure({ code: code as keyof typeof expected, message: `about ${code}` })
      expect({ code: failure.code, message: failure.message, status: statusOf(failure) }).toEqual({
        code,
        message: `about ${code}`,
        status,
      })
    })
  })
})
