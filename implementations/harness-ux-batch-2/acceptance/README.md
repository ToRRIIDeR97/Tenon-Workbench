# Acceptance tests

Beside the code; run from each package directory.

| Criterion | Test |
| --- | --- |
| AC-1 | `app/src/components/prompt-input/harness-memory.test.ts` (retry), `app/src/pages/home/home-composer.test.ts` (no Suspense) |
| AC-2 | `app/src/components/prompt-input/harness-memory.test.ts`, `app/src/components/prompt-input/harness-switch.test.ts` |
| AC-3 | `app/src/pages/home/home-composer.test.ts` |
| AC-4 | `app/src/components/session/running-dot.test.ts` |
| AC-5 | `app/src/features/second-brain/thread-finish.test.ts` |
| AC-6 | `dictation/src/language.rs` (`cargo test`), `desktop/src/main/dictation-partial.test.ts`, `app/src/components/prompt-input/dictation-language.test.ts` |
| AC-7 | `core/test/session-todo-plan-acp.test.ts` |
| AC-8 | `core/test/session-runner-title.test.ts` |
| AC-9 | `app/src/components/session/session-context-previous.test.ts` |
| AC-10 | `app/src/features/second-brain/calendar-agenda.test.ts` |
