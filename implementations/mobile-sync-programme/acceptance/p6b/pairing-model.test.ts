import { describe, expect, test } from "bun:test"
import { deviceRows, pairingLink, parsePairingLink } from "./remote-access-model"

describe("AC-P6b-5 pairing link and devices", () => {
  test("the QR link carries the address and the code, and reads back", () => {
    const link = pairingLink({ url: "http://192.168.1.20:47100", code: "ABCD2345" })
    expect(link).toBe("tenon://pair?server=http%3A%2F%2F192.168.1.20%3A47100&code=ABCD2345")
    expect(parsePairingLink(link)).toEqual({ url: "http://192.168.1.20:47100", code: "ABCD2345" })
    expect(parsePairingLink("https://example.com/?code=1")).toBeUndefined()
    expect(parsePairingLink("tenon://pair?server=ftp%3A%2F%2Fx&code=ABCD2345")).toBeUndefined()
    expect(parsePairingLink("tenon://pair?server=http%3A%2F%2F10.0.0.2%3A47100")).toBeUndefined()
  })

  test("devices list newest first with when they were last seen", () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0)
    const rows = deviceRows(
      [
        { id: "dev_a", name: "Old tablet", createdAt: now - 10 * 86_400_000, lastSeenAt: null },
        { id: "dev_b", name: "Pixel", createdAt: now - 86_400_000, lastSeenAt: now - 5 * 60_000 },
      ],
      now,
    )
    expect(rows.map((row) => row.id)).toEqual(["dev_b", "dev_a"])
    expect(rows[0]!.seen).toEqual({ key: "secondBrain.settings.remote.seen.minutes", minutes: 5 })
    expect(rows[1]!.seen).toEqual({ key: "secondBrain.settings.remote.seen.never" })
  })
})
