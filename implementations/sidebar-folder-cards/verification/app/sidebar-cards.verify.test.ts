import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

// Same contract as acceptance/, through different boundaries.

const app = path.resolve(import.meta.dir, "../../../../tenon/packages/app/src")
const read = (file: string) => (existsSync(path.join(app, file)) ? readFileSync(path.join(app, file), "utf8") : "")
const load = async () => {
  const module = await import("../../../../tenon/packages/app/src/features/second-brain/sidebar-grouping").catch(
    () => undefined,
  )
  expect(module).toBeDefined()
  return module!
}

type Session = { id: string; directory: string; time: { created: number; updated?: number } }
const node = (id: string, created = 0, updated?: number, children: ReturnType<typeof node>[] = []) => ({
  session: { id, directory: "/w", time: { created, updated } } as Session,
  children,
})
const states = (map: Record<string, "approval" | "running" | "idle">) => (session: Session) => map[session.id] ?? "idle"

describe("grouping boundaries", () => {
  test("no threads gives no cards in either mode", async () => {
    const { attentionCards, recentCards } = await load()
    expect(attentionCards([], states({}))).toEqual([])
    expect(recentCards([], states({}), Date.now())).toEqual([])
  })

  test("order inside a card follows the roots", async () => {
    const { attentionCards } = await load()
    const [card] = attentionCards([node("z"), node("a"), node("m")], states({}))
    expect(card?.threads.map((item) => item.session.id)).toEqual(["z", "a", "m"])
  })

  test("a grandchild's state reaches the root", async () => {
    const { nodeState } = await load()
    const tree = node("root", 0, undefined, [node("child", 0, undefined, [node("leaf")])])
    expect(nodeState(tree, states({ leaf: "approval", child: "running" }))).toBe("approval")
  })

  test("the summary counts children but total counts roots", async () => {
    const { cardSummary } = await load()
    const tree = [node("a", 0, undefined, [node("b"), node("c")]), node("d")]
    expect(cardSummary(tree, states({ b: "running", c: "running", d: "approval" }))).toEqual({
      running: 2,
      approvals: 1,
      total: 2,
    })
  })

  test("a thread never updated uses its created time", async () => {
    const { recentCards } = await load()
    const now = new Date(2026, 10, 4, 12).getTime()
    const cards = recentCards([node("a", new Date(2026, 10, 4, 8).getTime())], states({}), now)
    expect(cards[0]?.id).toBe("recent:today")
  })

  test("midnight belongs to the new day", async () => {
    const { recentCards } = await load()
    const now = new Date(2026, 10, 4, 0, 30).getTime()
    const cards = recentCards(
      [node("a", new Date(2026, 10, 4, 0, 0).getTime()), node("b", new Date(2026, 10, 3, 23, 59).getTime())],
      states({}),
      now,
    )
    expect(cards.map((card) => card.id)).toEqual(["recent:today", "recent:yesterday"])
  })

  test("Earlier starts two calendar days back, across a month end", async () => {
    const { recentCards } = await load()
    const now = new Date(2026, 11, 1, 9).getTime()
    const cards = recentCards(
      [node("a", new Date(2026, 10, 30, 1).getTime()), node("b", new Date(2026, 10, 29, 23).getTime())],
      states({}),
      now,
    )
    expect(cards.map((card) => card.id)).toEqual(["recent:yesterday", "recent:earlier"])
  })

  test("parseGrouping refuses inherited and non-string values", async () => {
    const { parseGrouping } = await load()
    expect(parseGrouping("constructor")).toBe("project")
    expect(parseGrouping(3)).toBe("project")
    expect(parseGrouping(null)).toBe("project")
  })
})

describe("the top line", () => {
  const css = read("index.css")
  const rules = css.slice(css.indexOf(".sidebar-card-line"))

  test("it moves with transform, not position", () => {
    const keyframes = rules.slice(rules.indexOf("@keyframes"))
    expect(keyframes).toContain("transform")
    expect(keyframes.slice(0, keyframes.indexOf("@media"))).not.toMatch(/\bleft\s*:/)
  })

  test("reduced motion stops the animation and leaves the line visible", () => {
    const reduced = rules.slice(rules.indexOf("prefers-reduced-motion: reduce"))
    expect(reduced).toContain("animation: none")
    expect(reduced).not.toContain("display: none")
  })
})

describe("the view", () => {
  const view = read("components/second-brain-sidebar.tsx")

  test("status marks have accessible names through i18n", () => {
    expect(view).toContain('role="img"')
    expect(view).toContain("secondBrain.sidebar.running")
    expect(read("i18n/en.ts")).toContain("secondBrain.sidebar.needsYou")
  })

  test("existing thread contracts stay", () => {
    for (const hook of ["data-sidebar-thread=", "data-sidebar-thread-open", "data-sidebar-project=", "draggable="])
      expect(view).toContain(hook)
  })

  test("previous and next follow the current grouping", () => {
    const controller = read("components/sidebar/sidebar-controller.ts")
    const line = controller.indexOf("flattenThreads")
    expect(line).toBeGreaterThan(-1)
    expect(controller).toMatch(/grouping\(\)|state\.grouping/)
    expect(controller).toMatch(/attentionCards|threadCards|cards\(\)/)
  })
})
