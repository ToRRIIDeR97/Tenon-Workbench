import { describe, expect, test } from "bun:test"
import type { Session, SessionV2Info } from "@opencode-ai/sdk/v2/client"
import { QueryClient } from "@tanstack/solid-query"
import {
  applyHomeSessionEvent,
  appendHomeSessionEvent,
  createHomeSessionIndexCache,
  HOME_V2_SESSION_PAGE_LIMIT,
  type HomeSessionEvent,
  type HomeSessionEvents,
  type HomeSessionIndex,
  loadHomeSessionIndex,
  homeSessionIndexQueryOptions,
  homeSessionIndexSessions,
  homeSessionIndexParents,
  homeSessionIndexRefresh,
  parseHomeSessionIndex,
  retainHomeSessions,
} from "./home-session-index"

const session = (input: {
  id: string
  directory?: string
  parentID?: string
  archived?: number
  updated?: number
}) => ({
  id: input.id,
  parentID: input.parentID,
  projectID: "project",
  harnessInstanceID: "opencode",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: input.updated ?? 1, archived: input.archived },
  title: input.id,
  location: { directory: input.directory ?? "/project" },
})

describe("Home session parent links", () => {
  const event = (type: "session.created" | "session.updated" | "session.deleted", info: Session, sequence: number) => ({
    sequence,
    event: { type, properties: { sessionID: info.id, info } } satisfies HomeSessionEvent,
  })
  const legacy = (id: string, parentID?: string, archived?: number) =>
    ({ id, parentID, directory: "/project", time: { created: 1, updated: 1, archived } }) as unknown as Session

  test("loading keeps the links while Home's root list stays roots only", async () => {
    const index = await loadHomeSessionIndex(async () => ({
      data: {
        data: [
          session({ id: "root" }),
          session({ id: "child", parentID: "root" }),
          session({ id: "grandchild", parentID: "child" }),
          session({ id: "gone", parentID: "root", archived: 5 }),
        ],
        cursor: {},
      },
    }))

    expect(index.sessions.map((item) => item.id)).toEqual(["root"])
    expect(index.parents).toEqual({ child: "root", grandchild: "child" })
  })

  test("live events add and drop links without touching the root list", () => {
    const root = legacy("root")
    const index = { sessions: [root], eventSequence: 0, parents: { old: "root", tidy: "root" } }
    const events = {
      sequence: 3,
      entries: [
        event("session.created", legacy("new", "root"), 1),
        event("session.deleted", legacy("old", "root"), 2),
        event("session.updated", legacy("tidy", "root", 9), 3),
      ],
    }

    expect(homeSessionIndexParents(index, events)).toEqual({ new: "root" })
    expect(homeSessionIndexSessions(index, events)).toEqual([root])
  })

  test("an update to a known child keeps the same object", () => {
    const parents = { child: "root" }
    const events = { sequence: 1, entries: [event("session.updated", legacy("child", "root"), 1)] }
    expect(homeSessionIndexParents({ sessions: [], eventSequence: 0, parents }, events)).toBe(parents)
  })

  test("an index without links, or no index, has none", () => {
    expect(homeSessionIndexParents({ sessions: [], eventSequence: 0 }, undefined)).toEqual({})
    expect(homeSessionIndexParents(undefined, undefined)).toEqual({})
  })

  test("the cache keeps links when it folds events into the index", () => {
    const queryClient = new QueryClient()
    const cache = createHomeSessionIndexCache(queryClient, "server")
    queryClient.setQueryData<HomeSessionIndex>(cache.indexKey, {
      sessions: [],
      eventSequence: 0,
      parents: { a: "root" },
    })

    cache.apply(event("session.created", legacy("b", "root"), 1).event)

    const index = queryClient.getQueryData<HomeSessionIndex>(cache.indexKey)
    expect(cache.parents(index, queryClient.getQueryData<HomeSessionEvents>(cache.eventsKey))).toEqual({
      a: "root",
      b: "root",
    })
    expect(index?.sessions).toEqual([])
  })
})

describe("Home V2 session index", () => {
  test("loads the Home index with one global V2 request", async () => {
    const calls: unknown[] = []
    const result = await loadHomeSessionIndex(async (input) => {
      calls.push(input)
      return { data: { data: [session({ id: "root" })], cursor: {} } }
    })

    expect(result.sessions).toHaveLength(1)
    expect(calls).toEqual([{ limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc" }])
  })

  test("shared query options never go stale and record the event sequence they started at", async () => {
    const completed: number[] = []
    const options = homeSessionIndexQueryOptions(
      {
        indexKey: ["home", "session-index", "server"],
        eventSequence: () => 7,
        complete: (sequence) => completed.push(sequence),
      },
      async () => ({ data: { data: [session({ id: "root" })], cursor: {} } }),
    )

    expect(options.staleTime).toBe(Infinity)
    expect(options.queryKey).toEqual(["home", "session-index", "server"])
    const index = await options.queryFn({})
    expect(index.eventSequence).toBe(7)
    expect(index.sessions.map((item) => item.id)).toEqual(["root"])
    expect(completed).toEqual([7])
  })

  test("loads subsequent pages until the session index is complete", async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    const result = await loadHomeSessionIndex(
      async (input, options) => {
        calls.push({ input, signal: options.signal })
        if (!("cursor" in input)) {
          return {
            data: {
              data: Array.from({ length: HOME_V2_SESSION_PAGE_LIMIT }, (_, index) =>
                session({ id: `page-1-${index}` }),
              ),
              cursor: { next: "next-page" },
            },
          }
        }
        return { data: { data: [session({ id: "page-2" })], cursor: {} } }
      },
      0,
      controller.signal,
    )

    expect(result.sessions).toHaveLength(HOME_V2_SESSION_PAGE_LIMIT + 1)
    expect(calls).toEqual([
      { input: { limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc" }, signal: controller.signal },
      {
        input: { limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc", cursor: "next-page" },
        signal: controller.signal,
      },
    ])
  })

  test("maps visible roots to Home session summaries", () => {
    const activeNull = {
      ...session({ id: "active-null", updated: 20 }),
      time: { created: 1, updated: 20, archived: null },
    } as unknown as SessionV2Info
    const result = parseHomeSessionIndex([
      session({ id: "root", updated: 30 }),
      activeNull,
      session({ id: "child", parentID: "root", updated: 40 }),
      session({ id: "archived", archived: 50, updated: 50 }),
    ])

    expect(result).toEqual([
      expect.objectContaining({
        id: "root",
        slug: "root",
        version: "",
        directory: "/project",
        projectID: "project",
        title: "root",
        time: { created: 1, updated: 30 },
      }),
      expect.objectContaining({
        id: "active-null",
        time: { created: 1, updated: 20, archived: null },
      }),
    ])
  })

  test("preserves the per-directory Home retention limit", () => {
    const now = 10 * 60 * 60 * 1000
    const sessions = Array.from({ length: 80 }, (_, index) => ({
      ...parseHomeSessionIndex([session({ id: `session-${index}`, updated: index + 1 })])[0],
      directory: index % 2 === 0 ? "/one" : "/two",
    }))

    const retained = retainHomeSessions(sessions, 10, now)
    expect(retained.filter((item) => item.directory === "/one")).toHaveLength(10)
    expect(retained.filter((item) => item.directory === "/two")).toHaveLength(10)
  })

  test("replays session events over the loaded index", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const created = { ...initial[0], id: "new", slug: "new", title: "new", time: { created: 2, updated: 2 } }

    const afterCreate = applyHomeSessionEvent(initial, {
      type: "session.created",
      properties: { sessionID: created.id, info: created },
    })
    expect(
      applyHomeSessionEvent(afterCreate, {
        type: "session.deleted",
        properties: { sessionID: initial[0]!.id, info: initial[0]! },
      }),
    ).toEqual([created])
  })

  test("applies only events newer than the index baseline", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const stale = { ...initial[0], title: "stale" }
    const current = { ...initial[0], title: "current" }
    const first = appendHomeSessionEvent(undefined, {
      type: "session.updated",
      properties: { sessionID: stale.id, info: stale },
    })
    const events = appendHomeSessionEvent(first, {
      type: "session.updated",
      properties: { sessionID: current.id, info: current },
    })

    expect(homeSessionIndexSessions({ sessions: initial, eventSequence: 1 }, events)[0]?.title).toBe("current")
  })

  test("refetches after reconnect, disposal, and session moves", () => {
    expect(homeSessionIndexRefresh("server.connected", false)).toEqual({ connected: true, refetch: false })
    expect(homeSessionIndexRefresh("server.connected", true)).toEqual({ connected: true, refetch: true })
    expect(homeSessionIndexRefresh("global.disposed", true).refetch).toBe(true)
    expect(homeSessionIndexRefresh("session.next.moved", true).refetch).toBe(true)
  })
})
