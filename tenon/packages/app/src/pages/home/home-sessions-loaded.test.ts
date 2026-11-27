import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { cachedQueryData } from "@/utils/query-data"

const cache = (data: Record<string, unknown>) => ({
  getQueryData: <Data>(key: readonly unknown[]) => data[String(key[0])] as Data | undefined,
})

const suspendingQuery = (dataUpdatedAt: number) => ({
  dataUpdatedAt,
  get data(): never {
    throw new Error("reading data of a query that is fetching suspends the page around it")
  },
})

describe("Home thread list loading", () => {
  test("a query that has never loaded gives nothing and its data is not read", () => {
    expect(cachedQueryData(cache({ index: "cached" }), suspendingQuery(0), ["index"])).toBeUndefined()
  })

  test("a loaded query gives the cached data even while it fetches again", () => {
    expect(cachedQueryData<string>(cache({ index: "cached" }), suspendingQuery(1), ["index"])).toBe("cached")
  })

  test("the Home controller reads both session queries from the cache, never through their data getter", () => {
    const source = readFileSync(path.join(import.meta.dir, "home-sessions-controller.tsx"), "utf8")
    expect(source).toContain("cachedQueryData<HomeSessionIndex>(queryClient, sessionLoad")
    expect(source).toContain("cachedQueryData<HomeSessionEvents>(queryClient, sessionEventLoad")
    expect(source).not.toMatch(/sessionLoad\.data|sessionEventLoad\.data/)
  })
})
