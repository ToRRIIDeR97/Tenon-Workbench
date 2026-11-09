import { describe, expect, test } from "bun:test"
import { utils, write } from "xlsx"
import { sheetRows } from "./sheet-rows"

function workbook(bookType: "xlsx" | "xls" | "ods") {
  const book = utils.book_new()
  utils.book_append_sheet(book, utils.aoa_to_sheet([["Name", "Count"], ["a", 1], [], ["b", null, true]]), "First")
  utils.book_append_sheet(book, utils.aoa_to_sheet([["only"]]), "Second")
  return new Uint8Array(write(book, { type: "array", bookType }) as ArrayBuffer)
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

  test("gives no sheets for bytes that aren't a workbook", async () => {
    expect(await sheetRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]))).toEqual([])
  })
})
