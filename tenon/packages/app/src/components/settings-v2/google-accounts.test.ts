import { describe, expect, test } from "bun:test"
import { googleAccountRows } from "./google-accounts"

const calendar = (email: string, id = email) => ({
  id,
  email,
  label: email,
  access: "write" as const,
  pendingWrites: 0,
  failedWrites: 0,
})

describe("googleAccountRows", () => {
  test("a Gmail account and its calendar connection share one row, matched without case", () => {
    const rows = googleAccountRows(
      [
        { id: "m1", provider: "gmail", address: "Nat@Gmail.com" },
        { id: "m2", provider: "outlook", address: "nat@outlook.com" },
      ],
      [calendar("nat@gmail.com", "c1"), calendar("work@gmail.com", "c2")],
    )
    expect(rows.map((row) => [row.address, row.mail?.id, row.calendar?.id])).toEqual([
      ["Nat@Gmail.com", "m1", "c1"],
      ["work@gmail.com", undefined, "c2"],
    ])
  })

  test("a Gmail account without a calendar connection has its switch off", () => {
    expect(
      googleAccountRows([{ id: "m1", provider: "gmail", address: "a@gmail.com" }], [])[0]?.calendar,
    ).toBeUndefined()
  })
})
