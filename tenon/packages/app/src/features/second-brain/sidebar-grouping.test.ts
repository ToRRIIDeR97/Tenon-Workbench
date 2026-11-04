import { describe, expect, test } from "bun:test"
import {
  attentionCards,
  cardSummary,
  isGroupingCard,
  linkedStates,
  nodeState,
  parseGrouping,
  recentCards,
  threadState,
  type ThreadState,
} from "./sidebar-grouping"
import { flattenThreads, type SidebarSession, type ThreadNode } from "./sidebar-threads"

const node = (id: string, updated = 0, children: ThreadNode[] = []): ThreadNode => ({
  session: { id, directory: "/w", time: { created: updated, updated } },
  children,
})
const states = (map: Record<string, ThreadState>) => (session: SidebarSession) => map[session.id] ?? "idle"
const ids = (nodes: ThreadNode[]) => nodes.map((item) => item.session.id)

describe("parseGrouping", () => {
  test("keeps the three modes and turns anything else into project", () => {
    expect(["project", "attention", "recent"].map(parseGrouping)).toEqual(["project", "attention", "recent"])
    expect([undefined, null, 5, {}, "Attention", ""].map(parseGrouping)).toEqual(Array(6).fill("project"))
  })
})

describe("threadState", () => {
  test("maps run status, counting retry as running and letting approval win", () => {
    expect(threadState({ type: "busy" }, 0)).toBe("running")
    expect(threadState({ type: "retry", attempt: 1, message: "rate limited", next: 0 }, 0)).toBe("running")
    expect(threadState({ type: "retry", attempt: 1, message: "rate limited", next: 0 }, 1)).toBe("approval")
    expect(threadState({ type: "busy" }, 2)).toBe("approval")
    expect(threadState(undefined, 1)).toBe("approval")
  })

  test("settled threads are idle", () => {
    expect(threadState({ type: "idle" }, 0)).toBe("idle")
    expect(threadState(undefined, 0)).toBe("idle")
  })
})

describe("nodeState", () => {
  test("takes the most urgent state at any depth", () => {
    const tree = node("root", 0, [node("child", 0, [node("grandchild")])])
    expect(nodeState(tree, states({}))).toBe("idle")
    expect(nodeState(tree, states({ grandchild: "running" }))).toBe("running")
    expect(nodeState(tree, states({ root: "running", grandchild: "approval" }))).toBe("approval")
  })
})

describe("cardSummary", () => {
  test("counts states across subtrees and roots for total", () => {
    const nodes = [node("a", 0, [node("a1"), node("a2")]), node("b")]
    expect(cardSummary(nodes, states({ a: "running", a1: "running", a2: "approval", b: "approval" }))).toEqual({
      running: 2,
      approvals: 2,
      total: 2,
    })
  })

  test("an empty card is all zeros", () => {
    expect(cardSummary([], states({}))).toEqual({ running: 0, approvals: 0, total: 0 })
  })
})

describe("attentionCards", () => {
  test("keeps the order of roots inside each card", () => {
    const cards = attentionCards(
      [node("c"), node("a"), node("d"), node("b")],
      states({ c: "approval", d: "approval", a: "running" }),
    )
    expect(cards.map((card) => ids(card.threads))).toEqual([["c", "d"], ["a"], ["b"]])
  })

  test("returns nothing for no threads", () => {
    expect(attentionCards([], states({}))).toEqual([])
  })

  test("moves a child with its root, and the summary still sees the child", () => {
    const [card] = attentionCards([node("a", 0, [node("child")])], states({ child: "approval" }))
    expect(card?.id).toBe("attention:needs")
    expect(ids(card?.threads ?? [])).toEqual(["a"])
    expect(card?.summary).toEqual({ running: 0, approvals: 1, total: 1 })
  })
})

describe("recentCards", () => {
  const now = new Date(2026, 10, 4, 12).getTime()
  const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month, day, hour, minute).getTime()
  const days = (roots: ThreadNode[], time = now) =>
    recentCards(roots, states({}), time).map((card) => [card.id, ids(card.threads)])

  test("splits on local midnight", () => {
    expect(
      days([
        node("today", at(10, 4)),
        node("yesterday-late", at(10, 3, 23, 59)),
        node("yesterday", at(10, 3)),
        node("earlier", at(10, 2, 23, 59)),
      ]),
    ).toEqual([
      ["recent:today", ["today"]],
      ["recent:yesterday", ["yesterday-late", "yesterday"]],
      ["recent:earlier", ["earlier"]],
    ])
  })

  test("falls back to the creation time, and an update from the future is Today", () => {
    const session = { id: "created", directory: "/w", time: { created: at(10, 3, 9) } }
    expect(days([{ session, children: [] }])).toEqual([["recent:yesterday", ["created"]]])
    expect(days([node("future", at(10, 6))])).toEqual([["recent:today", ["future"]]])
  })

  test("yesterday crosses a month boundary", () => {
    expect(days([node("oct-31", at(9, 31, 20))], at(10, 1, 8))).toEqual([["recent:yesterday", ["oct-31"]]])
  })

  test("leaves out empty cards", () => {
    expect(days([])).toEqual([])
    expect(days([node("earlier", at(0, 1))])).toEqual([["recent:earlier", ["earlier"]]])
  })
})

describe("card order for previous and next thread", () => {
  test("flattening attention cards walks the groups in their on-screen order", () => {
    const cards = attentionCards(
      [node("idle"), node("running"), node("waiting", 0, [node("child")])],
      states({ running: "running", waiting: "approval" }),
    )
    expect(flattenThreads(cards.flatMap((card) => card.threads)).map((session) => session.id)).toEqual([
      "waiting",
      "child",
      "running",
      "idle",
    ])
  })
})

describe("linked child threads", () => {
  // A root in a collapsed Project: the index drops children, so only the links know about them.
  const collapsed = [node("root"), node("quiet")]
  const parents = { child: "root", grandchild: "child" }
  const linkedFrom = (active: Record<string, ThreadState>, links: Record<string, string> = parents) => {
    const map = linkedStates(Object.keys(active), links, (id) => active[id] ?? "idle")
    return (session: SidebarSession) => map.get(session.id) ?? []
  }

  test("a root with no loaded children takes an approving child's state", () => {
    const cards = attentionCards(collapsed, states({}), linkedFrom({ child: "approval" }))
    expect(cards.map((card) => [card.id, ids(card.threads)])).toEqual([
      ["attention:needs", ["root"]],
      ["attention:other", ["quiet"]],
    ])
    expect(cards[0]?.summary).toEqual({ running: 0, approvals: 1, total: 1 })
  })

  test("state rolls up from any depth and approval still wins", () => {
    const linked = linkedFrom({ grandchild: "running", child: "approval" })
    expect(nodeState(node("root"), states({}), linked)).toBe("approval")
    expect(nodeState(node("root"), states({}), linkedFrom({ grandchild: "running" }))).toBe("running")
  })

  test("each hidden child counts", () => {
    const linked = linkedFrom({ a: "approval", b: "approval", c: "running" }, { a: "root", b: "root", c: "root" })
    expect(cardSummary([node("root")], states({}), linked)).toEqual({ running: 1, approvals: 2, total: 1 })
  })

  test("expanding a Project gives the same grouping and summary", () => {
    const active = { child: "approval" } as const
    const expanded = [node("root", 0, [node("child")]), node("quiet")]
    const shape = (roots: ThreadNode[]) =>
      attentionCards(roots, states(active), linkedFrom(active)).map((card) => [card.id, card.summary])
    expect(shape(expanded)).toEqual(shape(collapsed))
  })

  test("a thread that is both a root and a linked child counts once in a card", () => {
    const active = { child: "running" } as const
    const summary = cardSummary([node("root"), node("child")], states(active), linkedFrom(active))
    expect(summary).toEqual({ running: 1, approvals: 0, total: 2 })
  })

  test("Recent cards see linked state too", () => {
    const [card] = recentCards([node("root", 5)], states({}), 5, linkedFrom({ child: "running" }))
    expect(card?.summary).toEqual({ running: 1, approvals: 0, total: 1 })
  })

  test("idle threads add nothing, and a broken link loop ends", () => {
    expect(linkedStates(["child"], parents, () => "idle").size).toBe(0)
    const loop = linkedStates(["a"], { a: "b", b: "a" }, () => "running")
    expect(loop.get("b")).toEqual([{ id: "a", state: "running" }])
    expect(loop.has("a")).toBe(false)
  })
})

describe("isGroupingCard", () => {
  test("is true only for Attention and Recent cards", () => {
    expect(["attention:needs", "recent:today"].map(isGroupingCard)).toEqual([true, true])
    expect(["__brain__", "prj_repo", "recent"].map(isGroupingCard)).toEqual([false, false, false])
  })
})
