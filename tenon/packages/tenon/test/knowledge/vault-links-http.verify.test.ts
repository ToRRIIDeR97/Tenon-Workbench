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

describe("AC-6/AC-8 (verification)", () => {
  it.instance("a page with no links pointing at it has an empty list", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      yield* create(headers, "Lonely.md", { body: "x", title: "Lonely", create: true })
      const links = yield* request("/second-brain/vault/backlinks?path=Lonely.md", { headers }).pipe(
        Effect.flatMap(json<ReadonlyArray<unknown>>),
      )
      expect(links).toEqual([])
    }),
  )

  it.instance("moving back to the workspace root with projectId null, and the history moves along", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const first = yield* create(headers, "Note.md", { body: "one", projectId: project.id, create: true })
      const second = yield* put(headers, first.info.path, { body: "two", expectedRevision: first.revision }).pipe(
        Effect.flatMap(json<Page>),
      )
      const moved = yield* request("/second-brain/vault/page/move", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: second.info.path, expectedRevision: second.revision, projectId: null }),
      }).pipe(Effect.flatMap(json<{ page: Page }>))
      expect(moved.page.info.path).toBe("Note.md")
      expect(moved.page.info.projectId).toBeNull()
      expect(moved.page.body.trimEnd()).toBe("two")
      const history = yield* request("/second-brain/vault/page/history?path=Note.md", { headers }).pipe(
        Effect.flatMap(json<ReadonlyArray<{ revision: string }>>),
      )
      expect(history.length).toBe(1)
    }),
  )

  it.instance("a link that still resolves to another page with the same file name is not rewritten", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const plan = yield* create(headers, "Plan.md", { body: "root", title: "Plan", create: true })
      yield* create(headers, "Plan.md", { body: "in project", title: "Plan", projectId: project.id, create: true })
      yield* create(headers, "A.md", { body: "[[Plan]]", title: "A", create: true })
      const moved = yield* request("/second-brain/vault/page/move", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: "Plan.md", expectedRevision: plan.revision, title: "Old plan" }),
      }).pipe(Effect.flatMap(json<{ updatedLinks: number }>))
      expect(moved.updatedLinks).toBe(0)
      const linking = yield* request("/second-brain/vault/page?path=A.md", { headers }).pipe(Effect.flatMap(json<Page>))
      expect(linking.body.trimEnd()).toBe("[[Plan]]")
    }),
  )

  it.instance("a move with nothing to change is rejected as invalid", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      const plan = yield* create(headers, "Plan.md", { body: "x", title: "Plan", create: true })
      const result = yield* request("/second-brain/vault/page/move", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: "Plan.md", expectedRevision: plan.revision }),
      })
      expect(result.status).toBe(400)
    }),
  )
})
