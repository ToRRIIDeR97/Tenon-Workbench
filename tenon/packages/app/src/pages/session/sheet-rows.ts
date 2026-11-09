export type SheetRows = { name: string; rows: string[][] }

// Parses workbook bytes (.xlsx, .xls, .ods) into string cells per sheet. Unreadable bytes give no
// sheets, so the viewer shows its "can't be shown" text. xlsx loads lazily, in its own chunk.
export async function sheetRows(bytes: Uint8Array): Promise<SheetRows[]> {
  const { read, utils } = await import("xlsx")
  const workbook = (() => {
    try {
      return read(bytes, { type: "array" })
    } catch {
      return undefined
    }
  })()
  if (!workbook) return []
  return workbook.SheetNames.map((name) => ({
    name,
    rows: utils
      .sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, blankrows: false, defval: "" })
      .map((row) => row.map((cell) => String(cell ?? ""))),
  }))
}
