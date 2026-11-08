import type { SchemaIssue } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { InvalidRequestError } from "../errors"

export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@tenon/HttpApiSchemaError",
  { error: InvalidRequestError },
) {}

const ISSUE_LIMIT = 20
const KEY_LIMIT = 64

/**
 * Describe a schema rejection for logs by issue tag and path only. Effect's
 * formatted message embeds the rejected value, which can be an API key or note
 * text, so it must not reach the log file.
 */
export function issueSummary(issue: SchemaIssue.Issue): string {
  const collect = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): Array<string> => {
    if (issue._tag === "Pointer") return collect(issue.issue, [...path, ...issue.path])
    if (issue._tag === "Filter" || issue._tag === "Encoding") return collect(issue.issue, path)
    if ((issue._tag === "Composite" || issue._tag === "AnyOf") && issue.issues.length > 0)
      return issue.issues.flatMap((child) => collect(child, path))
    const at = path.map((key) => (typeof key === "symbol" ? "<symbol>" : String(key).slice(0, KEY_LIMIT))).join(".")
    return [`${issue._tag}${at ? ` at ${at}` : ""}`]
  }
  const issues = collect(issue, [])
  const shown = issues.slice(0, ISSUE_LIMIT).join("; ")
  return issues.length > ISSUE_LIMIT ? `${shown}; ... (${issues.length - ISSUE_LIMIT} more)` : shown
}
