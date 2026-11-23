import { describe, expect, test } from "bun:test"
import type { LogEntry, TimelineItem } from "./client"
import { milestoneRoad, projectNumbers, projectStory } from "./project-home-model"

const task = (id: string, status: TimelineItem["status"] = "todo"): TimelineItem => ({
  id,
  title: id,
  kind: "task",
  status,
})
const milestone = (id: string, status: TimelineItem["status"] = "todo", start?: string): TimelineItem => ({
  id,
  title: id,
  kind: "milestone",
  status,
  ...(start ? { start } : {}),
})

describe("milestoneRoad", () => {
  test("is empty without milestones", () => {
    expect(milestoneRoad([task("a"), task("b", "done")])).toEqual({
      stops: [],
      positions: [],
      fill: 0,
      current: undefined,
    })
  })

  test("fills through finished milestones and part of the way to the current one", () => {
    const road = milestoneRoad([
      milestone("one", "todo", "2026-11-14"),
      task("a", "done"),
      milestone("two"),
      task("b", "done"),
      milestone("three", "todo", "2026-12-04"),
      task("c", "done"),
      task("d"),
      task("e"),
      task("f"),
      milestone("four"),
      task("g"),
    ])
    expect(road.stops.map((stop) => [stop.id, stop.state])).toEqual([
      ["one", "done"],
      ["two", "done"],
      ["three", "current"],
      ["four", "ahead"],
    ])
    expect(road.positions).toEqual([0.25, 0.5, 0.75, 1])
    // Two finished stops, plus a quarter of the way to "three" (1 of its 4 tasks done).
    expect(road.fill).toBeCloseTo((2 + 0.25) / 4)
    expect(road.current?.id).toBe("three")
    expect(road.stops[0]?.date).toBe("2026-11-14")
  })

  test("shows progress toward the first milestone while it is current", () => {
    const road = milestoneRoad([milestone("one"), task("a", "done"), task("b", "done"), task("c"), milestone("two")])
    expect(road.current?.id).toBe("one")
    expect(road.fill).toBeCloseTo(2 / 3 / 2)
  })

  test("a single milestone sits at the end and fills by its own tasks", () => {
    const road = milestoneRoad([milestone("launch"), task("a", "done"), task("b")])
    expect(road.positions).toEqual([1])
    expect(road.fill).toBe(0.5)
  })

  test("a done milestone after the current one keeps its filled stop; the fill still stops at the current one", () => {
    const road = milestoneRoad([milestone("one"), task("a"), milestone("two", "done")])
    expect(road.stops.map((stop) => stop.state)).toEqual(["current", "done"])
    expect(road.fill).toBe(0)
  })

  test("a milestone with no tasks is current with nothing filled toward it, and all done fills the road", () => {
    const empty = milestoneRoad([milestone("one", "done"), milestone("two")])
    expect(empty.current).toMatchObject({ id: "two", done: 0, total: 0 })
    expect(empty.fill).toBe(0.5)
    const done = milestoneRoad([milestone("one", "done"), milestone("two"), task("a", "done")])
    expect(done.fill).toBe(1)
    expect(done.current).toBeUndefined()
  })
})

describe("projectNumbers", () => {
  test("counts tasks only, threads at work and pages", () => {
    const items = [milestone("m"), task("a"), task("b", "doing"), task("c", "done")]
    expect(projectNumbers(items, [{ running: true }, { running: false }], 3)).toEqual({
      open: 2,
      done: 1,
      running: 1,
      pages: 3,
    })
  })
})

describe("projectStory", () => {
  // Noon local time keeps the day boundaries clear of any time zone.
  const now = new Date(2026, 10, 23, 12, 0).getTime()
  const hours = (count: number) => now - count * 3_600_000
  const log = (at: number, text: string): LogEntry => ({
    at: new Date(at).toISOString(),
    author: "agent",
    text,
    machine: "m",
  })
  const labels = (entries: ReadonlyArray<{ key: string }>) => entries.map((entry) => entry.key)

  test("groups threads and log entries by day, running threads first", () => {
    const days = projectStory(
      [
        { id: "old", title: "Old thread", updated: hours(24 * 6), running: false },
        { id: "live", title: "Live thread", updated: hours(30), running: true },
        { id: "recent", title: "Recent thread", updated: hours(2), running: false },
      ],
      [log(hours(1), "Today's note"), log(hours(26), "Yesterday's note")],
      now,
    )
    expect(days.map((day) => day.daysAgo)).toEqual([0, 1, 6])
    expect(days[0]?.entries.map((entry) => (entry.kind === "thread" ? entry.id : entry.text))).toEqual([
      "live",
      "Today's note",
      "recent",
    ])
    expect(days[1]?.entries.map((entry) => (entry.kind === "log" ? entry.text : entry.id))).toEqual([
      "Yesterday's note",
    ])
  })

  test("puts running threads first, the most recently active of them first", () => {
    const days = projectStory(
      [
        { id: "a", title: "A", updated: hours(5), running: true },
        { id: "b", title: "B", updated: hours(1), running: true },
        { id: "c", title: "C", updated: hours(0.5), running: false },
      ],
      [],
      now,
    )
    expect(days[0]?.entries.map((entry) => (entry.kind === "thread" ? entry.id : ""))).toEqual(["b", "a", "c"])
  })

  test("keys stay the same when a new log entry arrives at either end", () => {
    const first = [log(hours(3), "Middle"), log(hours(2), "Later")]
    const keys = (entries: LogEntry[]) =>
      projectStory([], entries, now).flatMap((day) => day.entries.map((entry) => entry.key))
    const before = keys(first)
    const after = keys([log(hours(1), "Newest"), ...first, log(hours(4), "Oldest")])
    expect(before.every((key) => after.includes(key))).toBe(true)
    // Two entries with the same time, author and text still get distinct keys.
    const twice = keys([log(hours(1), "Same"), log(hours(1), "Same")])
    expect(new Set(twice).size).toBe(2)
  })

  test("splits days at local midnight", () => {
    const midnight = new Date(2026, 10, 23, 0, 0).getTime()
    const days = projectStory([], [log(midnight - 60_000, "Before"), log(midnight + 60_000, "After")], now)
    expect(days.map((day) => [day.daysAgo, day.entries.length])).toEqual([
      [0, 1],
      [1, 1],
    ])
  })

  test("leaves out unparsable log times and stopped threads without a valid time", () => {
    const days = projectStory(
      [
        { id: "broken", title: "Broken", updated: Number.NaN, running: false },
        { id: "epoch", title: "Epoch", updated: 0, running: false },
        { id: "working", title: "Working", updated: Number.NaN, running: true },
      ],
      [{ at: "not a date", author: "x", text: "Bad", machine: "m" }],
      now,
    )
    expect(days).toHaveLength(1)
    expect(labels(days[0]?.entries ?? [])).toEqual(["thread:working"])
  })

  test("counts anything stamped after now as today, in one group", () => {
    const days = projectStory([], [log(now + 26 * 3_600_000, "From a fast clock"), log(hours(1), "Earlier")], now)
    expect(days.map((day) => day.daysAgo)).toEqual([0])
    expect(days[0]?.entries).toHaveLength(2)
  })

  test("reads a date-only log stamp as that local day", () => {
    const days = projectStory([], [{ at: "2026-11-22", author: "you", text: "Dated", machine: "m" }], now)
    expect(days.map((day) => [day.day, day.daysAgo])).toEqual([["2026-11-22", 1]])
    expect(days[0]?.entries[0]).toMatchObject({ kind: "log", dateOnly: true })
  })

  test("counts calendar days across a daylight-saving change", () => {
    // 8 March 2026 starts daylight saving in North America; in a zone without it this is a plain five-day span, so
    // the check is best-effort and depends on the machine's zone.
    const march = new Date(2026, 2, 10, 12).getTime()
    const days = projectStory([], [log(new Date(2026, 2, 5, 12).getTime(), "Before")], march)
    expect(days[0]?.daysAgo).toBe(5)
  })

  test("is empty with nothing to tell", () => {
    expect(projectStory([], [], now)).toEqual([])
  })
})
