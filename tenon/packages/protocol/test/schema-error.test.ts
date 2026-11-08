import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { issueSummary } from "../src/middleware/schema-error"

const Body = Schema.Struct({
  provider: Schema.String,
  auth: Schema.Struct({ key: Schema.Number, note: Schema.optional(Schema.Literal("ok")) }),
})

const issueOf = (input: unknown) => {
  const result = Schema.decodeUnknownResult(Body)(input, { errors: "all" })
  if (Result.isSuccess(result)) throw new Error("expected a rejection")
  return result.failure.issue
}

describe("issueSummary", () => {
  test("names issue tags and paths without the rejected values", () => {
    const issue = issueOf({ auth: { key: "sk-secret-value", note: "private note text" } })
    const summary = issueSummary(issue)

    expect(summary).toContain("MissingKey at provider")
    expect(summary).toContain("InvalidType at auth.key")
    expect(summary).toContain("auth.note")
    expect(summary).not.toContain("sk-secret-value")
    expect(summary).not.toContain("private note text")
  })

  test("names the root issue when the payload is not an object", () => {
    expect(issueSummary(issueOf("sk-secret-value"))).toBe("InvalidType")
  })
})
