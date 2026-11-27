import { expect, test } from "bun:test"
import { pairingLink, qrPath } from "./remote-access-model"

test("the pairing QR code draws the three finder patterns of a square symbol", () => {
  const qr = qrPath(pairingLink({ url: "http://192.168.1.20:47100", code: "ABCD2345" }))
  expect((qr.size - 17) % 4).toBe(0)
  const dark = new Set(
    qr.path
      .split("M")
      .filter(Boolean)
      .map((cell) => cell.split("h")[0]),
  )
  for (const [row, col] of [
    [0, 0],
    [0, qr.size - 7],
    [qr.size - 7, 0],
  ])
    for (let step = 0; step < 7; step++) {
      expect(dark.has(`${col + step} ${row}`)).toBe(true)
      expect(dark.has(`${col} ${row + step}`)).toBe(true)
    }
  expect(dark.has("1 1")).toBe(false)
})
