import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const app = path.resolve(import.meta.dir, "../../../../tenon/packages/app/src")
const read = (file: string) => (existsSync(path.join(app, file)) ? readFileSync(path.join(app, file), "utf8") : "")
const grouping = () =>
  import("../../../../tenon/packages/app/src/features/second-brain/sidebar-grouping").catch(() => undefined)

type Session = { id: string; directory: string; time: { created: number; updated?: number } }
const node = (id: string, updated = 0, children: ReturnType<typeof node>[] = []) => ({
  session: { id, directory: "/w", time: { created: updated, updated } } as Session,
  children,
})
const states = (map: Record<string, "approval" | "running" | "idle">) => (session: Session) => map[session.id] ?? "idle"
const load = async () => {
  const module = await grouping()
  expect(module).toBeDefined()
  return module!
}

describe("AC-1 Group by", () => {
  test("AC-1 the three modes parse, and anything else is Project", async () => {
    const { parseGrouping } = await load()
    expect(parseGrouping("attention")).toBe("attention")
    expect(parseGrouping("recent")).toBe("recent")
    expect(parseGrouping("project")).toBe("project")
    expect(parseGrouping("something-else")).toBe("project")
    expect(parseGrouping(undefined)).toBe("project")
  })

  test("AC-1 the switch is on the sidebar and its choice is persisted", () => {
    expect(read("components/second-brain-sidebar.tsx")).toContain("SegmentedControlV2")
    expect(read("components/sidebar/sidebar-controller.ts")).toContain("grouping")
  })
})

describe("AC-2 Cards", () => {
  test("AC-2 Project and workspace groups render as cards", () => {
    const view = read("components/second-brain-sidebar.tsx")
    expect(view).toContain("data-sidebar-card")
    expect(view).toContain("data-sidebar-project")
    expect(view).toContain("data-sidebar-group")
  })
})

describe("AC-3 Attention", () => {
  test("AC-3 roots sort into Needs you, Running and Other, in that order", async () => {
    const { attentionCards } = await load()
    const cards = attentionCards(
      [node("a"), node("b"), node("c")],
      states({ a: "running", b: "approval" }),
    )
    expect(cards.map((card) => card.id)).toEqual(["attention:needs", "attention:running", "attention:other"])
    expect(cards.map((card) => card.threads.map((item) => item.session.id))).toEqual([["b"], ["a"], ["c"]])
  })

  test("AC-3 a root takes its most urgent child's state", async () => {
    const { attentionCards } = await load()
    const cards = attentionCards([node("a", 0, [node("child")])], states({ a: "running", child: "approval" }))
    expect(cards.map((card) => card.id)).toEqual(["attention:needs"])
  })

  test("AC-3 empty groups are left out", async () => {
    const { attentionCards } = await load()
    expect(attentionCards([node("a")], states({})).map((card) => card.id)).toEqual(["attention:other"])
  })
})

describe("AC-4 Recent", () => {
  const noon = new Date(2026, 10, 4, 12).getTime()
  test("AC-4 roots sort into Today, Yesterday and Earlier", async () => {
    const { recentCards } = await load()
    const cards = recentCards(
      [
        node("today", new Date(2026, 10, 4, 1).getTime()),
        node("yesterday", new Date(2026, 10, 3, 23).getTime()),
        node("earlier", new Date(2026, 9, 1).getTime()),
      ],
      states({}),
      noon,
    )
    expect(cards.map((card) => card.id)).toEqual(["recent:today", "recent:yesterday", "recent:earlier"])
  })

  test("AC-4 a card's summary counts its running and approval threads", async () => {
    const { recentCards } = await load()
    const [card] = recentCards([node("a", noon), node("b", noon)], states({ a: "running", b: "approval" }), noon)
    expect(card?.summary).toEqual({ running: 1, approvals: 1, total: 2 })
  })
})

describe("AC-5 and AC-6 Marks and the top line", () => {
  test("AC-5 retrying counts as running, and approval wins", async () => {
    const { threadState } = await load()
    expect(threadState({ type: "retry" } as never, 0)).toBe("running")
    expect(threadState({ type: "busy" } as never, 1)).toBe("approval")
    expect(threadState(undefined, 0)).toBe("idle")
  })

  test("AC-6 the sidebar no longer pulses and the card has a line", () => {
    const view = read("components/second-brain-sidebar.tsx")
    expect(view).not.toContain("running-pulse")
    expect(view).toContain("sidebar-card-line")
    expect(read("index.css")).toContain(".sidebar-card-line")
  })

  test("AC-6 Home keeps its pulse", () => {
    expect(read("pages/brain-home.tsx")).toContain("running-pulse")
    expect(read("index.css")).toContain(".running-pulse")
  })
})

describe("AC-7 Reduced motion", () => {
  test("AC-7 the line has a reduced-motion rule", () => {
    const css = read("index.css")
    const rule = css.slice(css.indexOf(".sidebar-card-line"))
    expect(rule).toContain("prefers-reduced-motion: reduce")
  })
})
