import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { it, json, put, request, setup } from "./vault-harness"

type Page = {
  info: { id: string; path: string; title: string; projectId: string | null }
  body: string
  revision: string
}

const create = (headers: Record<string, string>, page: string, body: unknown) =>
  put(headers, page, body).pipe(Effect.flatMap(json<Page>))

describe("AC-6 backlinks route", () => {
  it.instance("lists pages that link to a page by title, path or file name, not itself or code", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      yield* create(headers, "Plan.md", { body: "Self link [[Plan]]", title: "Plan", create: true })
      yield* create(headers, "A.md", { body: "Read [[plan#Goals|the plan]] first.", title: "A", create: true })
      yield* create(headers, "B.md", { body: "`[[Plan]]` is code", title: "B", create: true })
      yield* create(headers, "C.md", { body: "See [[Other]]", title: "C", create: true })
      const links = yield* request("/second-brain/vault/backlinks?path=Plan.md", { headers }).pipe(
        Effect.flatMap(json<ReadonlyArray<{ path: string; title: string; snippet: string }>>),
      )
      expect(links.map((item) => item.path)).toEqual(["A.md"])
      expect(links[0]?.snippet).toContain("[[plan#Goals|the plan]]")
      expect((yield* request("/second-brain/vault/backlinks?path=Missing.md", { headers })).status).toBe(404)
    }),
  )
})

describe("AC-8 move route", () => {
  it.instance("renaming keeps the id, removes the old file and rewrites links elsewhere", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      const plan = yield* create(headers, "Plan.md", { body: "v1", title: "Plan", create: true })
      yield* create(headers, "A.md", { body: "See [[Plan|it]] and [[Plan#Goals]]", title: "A", create: true })
      const moved = yield* request("/second-brain/vault/page/move", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: "Plan.md", expectedRevision: plan.revision, title: "Roadmap" }),
      }).pipe(Effect.flatMap(json<{ page: Page; updatedLinks: number }>))
      expect(moved.page.info.id).toBe(plan.info.id)
      expect(moved.page.info.path).toBe("Roadmap.md")
      expect(moved.page.info.title).toBe("Roadmap")
      expect(moved.updatedLinks).toBe(2)
      expect((yield* request("/second-brain/vault/page?path=Plan.md", { headers })).status).toBe(404)
      const linking = yield* request("/second-brain/vault/page?path=A.md", { headers }).pipe(Effect.flatMap(json<Page>))
      expect(linking.body.trimEnd()).toBe("See [[Roadmap|it]] and [[Roadmap#Goals]]")
    }),
  )

  it.instance("moving into a Project puts the page in its folder; a stale revision or a taken name is 409", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const plan = yield* create(headers, "Plan.md", { body: "v1", title: "Plan", create: true })
      yield* create(headers, "Taken.md", { body: "x", title: "Taken", create: true })
      const move = (body: unknown) =>
        request("/second-brain/vault/page/move", { method: "POST", headers, body: JSON.stringify(body) })
      expect((yield* move({ path: "Plan.md", expectedRevision: "stale", projectId: project.id })).status).toBe(409)
      expect((yield* move({ path: "Plan.md", expectedRevision: plan.revision, title: "Taken" })).status).toBe(409)
      const moved = yield* move({ path: "Plan.md", expectedRevision: plan.revision, projectId: project.id }).pipe(
        Effect.flatMap(json<{ page: Page }>),
      )
      expect(moved.page.info.path).toBe("Acme API/Plan.md")
      expect(moved.page.info.projectId).toBe(project.id)
    }),
  )
})
