import { describe, expect, test } from "bun:test"
import path from "node:path"
import { bucketDays, composition, fillDays, folderName, formatTokens, rangeSince } from "./usage-model"

describe("usage model", () => {
  test("ranges start at local midnight and include today", () => {
    const now = new Date(2026, 10, 25, 15, 30).getTime()
    expect(new Date(rangeSince("week", now))).toEqual(new Date(2026, 10, 19))
    expect(new Date(rangeSince("month", now))).toEqual(new Date(2026, 9, 27))
    expect(rangeSince("all", now)).toBe(0)
  })

  test("fills missing days with zeros so the chart keeps its scale", () => {
    const now = new Date(2026, 10, 25, 9).getTime()
    const bars = fillDays([{ day: "2026-11-24", fresh: 3, cached: 7 }], rangeSince("week", now), now)
    expect(bars).toHaveLength(7)
    expect(bars[0].day).toBe("2026-11-19")
    expect(bars.at(-1)?.day).toBe("2026-11-25")
    expect(bars.find((bar) => bar.day === "2026-11-24")).toEqual({ day: "2026-11-24", fresh: 3, cached: 7, total: 10 })
  })

  test("all time starts at the first day with usage", () => {
    const now = new Date(2026, 10, 25, 9).getTime()
    const bars = fillDays([{ day: "2026-11-20", fresh: 1, cached: 0 }], 0, now)
    expect(bars.map((bar) => bar.day)).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ])
  })

  test("groups long ranges into at most the requested bars without losing tokens", () => {
    const bars = Array.from({ length: 95 }, (_, index) => ({ day: `d${index}`, fresh: 1, cached: 2, total: 3 }))
    const grouped = bucketDays(bars, 40)
    expect(grouped.length).toBeLessThanOrEqual(40)
    expect(grouped.reduce((sum, bar) => sum + bar.total, 0)).toBe(285)
  })

  test("composition shares add up to one", () => {
    const parts = composition({ input: 1, output: 1, reasoning: 0, cacheRead: 2, cacheWrite: 0 })
    expect(parts.reduce((sum, part) => sum + part.share, 0)).toBe(1)
    expect(parts.find((part) => part.kind === "cacheRead")?.share).toBe(0.5)
  })

  test("formats small counts exactly and large ones compactly", () => {
    expect(formatTokens(950, "en")).toBe("950")
    expect(formatTokens(2_801_011_698, "en")).toBe("2.8B")
  })

  test("names a thread's folder on either platform", () => {
    expect(folderName(path.win32.join("C:\\", "Users", "me", "Acme API"))).toBe("Acme API")
    expect(folderName(path.posix.join("/", "Users", "me", "acme-api"))).toBe("acme-api")
  })
})
