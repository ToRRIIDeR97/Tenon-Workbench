# Acceptance tests

Run from `tenon/packages/<pkg>`:

| Criterion | Test |
| --- | --- |
| AC-1 | `app/src/components/harness-upgrades.test.ts` |
| AC-2 | `app/src/components/prompt-input/harness-update-choice.test.ts` |
| AC-3 | `session-ui/src/components/message-duration.test.ts` |
| AC-4 | `app/src/pages/session/timeline/resize-anchor.test.ts` (plus the existing `measure.test.ts`) |
| AC-5 | `desktop/src/main/browser-failure.test.ts`, `app/src/pages/session/browser-stage.test.ts` |
| AC-6 | `app/src/components/prompt-input/dictation-caption.test.ts` |

App: `bun test --conditions=solid --preload ./happydom.ts <files>`. Desktop and session-ui: `bun test <files>`.

The plan, tests and code share one author; there is no separate verification set.
