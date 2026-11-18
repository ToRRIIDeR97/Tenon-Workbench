# Verification tests

Edge cases the plan author added beside the acceptance tests. Same author as the code; not independent.

- `app/src/components/prompt-input/harness-ux-batch-2-verify.test.ts`: remembered models (unavailable, never remembered, built-in loop), model memory for the built-in loop and unlisted models, switch queue failure and collapse, `asksUser` code fences, emphasis, earlier questions and full-width marks, `finishMark` precedence, locale regions, agenda ignoring the cursor, context fallback across harnesses and newest report.
- `core/test/harness-ux-batch-2-verify.test.ts`: plan detection without todos, under another title, and an emptied plan.
