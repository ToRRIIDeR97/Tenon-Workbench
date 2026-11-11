# Acceptance tests

Beside the code, so each package's runner picks them up:

- AC-1 `tenon/packages/app/src/components/prompt-input/harness-prompt-input.test.ts`
- AC-2 `tenon/packages/app/src/utils/skill-picker.test.ts`, `tenon/packages/core/test/harness-feedback-batch.test.ts` (scan)
- AC-3 `tenon/packages/tenon/test/project/brain.test.ts` ("linking a folder again makes its archived card active")
- AC-4, AC-5 `tenon/packages/app/src/components/prompt-input/harness-choice.test.ts`
- AC-8 `tenon/packages/app/src/components/sidebar/instructions-error.test.ts`
- AC-10 `tenon/packages/app/src/components/session/session-context-reported.test.ts`
- AC-11 `tenon/packages/core/test/harness-feedback-batch.test.ts` (OpenCode Go key)

AC-6, AC-7, AC-9 and AC-12 are UI wiring, checked by inspection, typecheck and a run of the app.
