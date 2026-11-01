import { expect, test } from "bun:test"
import { report } from "./svg-report"

test("reports a clean diagram in one line", () => {
  expect(report({ width: 760, height: 420, issues: [], total: 0 })).toBe(
    "Rendered at 760×420px, as the chat shows it. No layout problems found.",
  )
})

test("lists the problems to fix and says how many it left out", () => {
  const text = report({
    width: 760,
    height: 300,
    issues: [{ kind: "overlap", message: 'Labels overlap: "a" and "b" near (10, 20).' }],
    total: 3,
  })
  expect(text).toBe(
    [
      "Rendered at 760×300px, as the chat shows it. 3 layout problems to fix before sending:",
      '- Labels overlap: "a" and "b" near (10, 20).',
      "…and 2 more.",
    ].join("\n"),
  )
})
