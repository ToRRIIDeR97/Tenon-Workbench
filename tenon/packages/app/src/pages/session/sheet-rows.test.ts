import { describe, expect, test } from "bun:test"
import { utils, write } from "xlsx"
import { sheetRows } from "./sheet-rows"

function workbook(bookType: "xlsx" | "xls" | "ods") {
  const book = utils.book_new()
  utils.book_append_sheet(book, utils.aoa_to_sheet([["Name", "Count"], ["a", 1], [], ["b", null, true]]), "First")
  utils.book_append_sheet(book, utils.aoa_to_sheet([["only"]]), "Second")
  return new Uint8Array(write(book, { type: "array", bookType }))
}

describe("sheetRows", () => {
  for (const bookType of ["xlsx", "xls", "ods"] as const) {
    test(`reads every sheet of an ${bookType} workbook as string rows`, async () => {
      expect(await sheetRows(workbook(bookType))).toEqual([
        {
          name: "First",
          rows: [
            ["Name", "Count", ""],
            ["a", "1", ""],
            ["b", "", "true"],
          ],
        },
        { name: "Second", rows: [["only"]] },
      ])
    })
  }

  test("shows ods date cells as the spreadsheet's own date and time", async () => {
    // Berlin skips 02:00-03:00 on 2024-03-31; a local-time conversion would show 03:30.
    const zone = process.env.TZ
    process.env.TZ = "Europe/Berlin"
    try {
      const book = utils.book_new()
      const dates = [
        new Date(Date.UTC(2024, 0, 15)),
        new Date(Date.UTC(2024, 6, 4, 13, 45)),
        new Date(Date.UTC(2024, 11, 31, 23, 59, 30)),
        new Date(Date.UTC(2024, 2, 31, 2, 30)),
      ]
      utils.book_append_sheet(book, utils.aoa_to_sheet([[...dates, 1.5]], { cellDates: true, UTC: true }), "Dates")
      const bytes = new Uint8Array(write(book, { type: "array", bookType: "ods" }))
      expect(await sheetRows(bytes)).toEqual([
        { name: "Dates", rows: [["2024-01-15", "2024-07-04 13:45", "2024-12-31 23:59:30", "2024-03-31 02:30", "1.5"]] },
      ])
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })

  test("gives no sheets for bytes that aren't a workbook", async () => {
    expect(await sheetRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]))).toEqual([])
  })
})
