export type SheetRows = { name: string; rows: string[][] }

type Cell = string | number | boolean | Date | null | undefined

const pad = (value: number) => String(value).padStart(2, "0")

// With `UTC: true` SheetJS keeps a date cell's wall-clock time in the Date's UTC fields, so the text
// matches the spreadsheet in every time zone, DST gaps included. Rounds to the second, as Calc does.
export function dateText(date: Date) {
  const at = new Date(Math.round(date.getTime() / 1000) * 1000)
  const day = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
  const [hours, minutes, seconds] = [at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()]
  if (hours === 0 && minutes === 0 && seconds === 0) return day
  return `${day} ${pad(hours)}:${pad(minutes)}${seconds === 0 ? "" : `:${pad(seconds)}`}`
}

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
      .sheet_to_json<Cell[]>(workbook.Sheets[name], { header: 1, blankrows: false, defval: "", UTC: true })
      .map((row) => row.map((cell) => (cell instanceof Date ? dateText(cell) : String(cell ?? "")))),
  }))
}
