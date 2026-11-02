# Acceptance tests (worker-visible)

These tests live inside the package that runs them, because Bun and Playwright resolve the
app's dependencies from the package folders, not from `implementations/`. Workers may add
tests; they must not delete, skip or weaken these assertions.

| Phase | File | Command |
| --- | --- | --- |
| shared | `tenon/packages/app/e2e/acceptance/open-app.ts` | helper |
| P1 | `tenon/packages/app/e2e/acceptance/sidebar-s4.spec.ts` | `cd tenon/packages/app && bunx playwright test e2e/acceptance/sidebar-s4.spec.ts --workers=1` |
| P2 | `tenon/packages/desktop/src/main/dictation.acceptance.test.ts` (+ `fixtures/fake-dictation-engine.mjs`) | `cd tenon/packages/desktop && bun test src/main/dictation.acceptance.test.ts` |
| P2 | `tenon/packages/dictation/tests/protocol_acceptance.rs` (needs `serde_json` as a dev-dependency) | `cd tenon/packages/dictation && cargo test` |
| P2 | `tenon/packages/app/e2e/acceptance/dictation-web.spec.ts` | `cd tenon/packages/app && bunx playwright test e2e/acceptance/dictation-web.spec.ts --workers=1` |

| P3 | `tenon/packages/tenon/test/acceptance/vault.acceptance.test.ts` | `cd tenon/packages/tenon && bun test test/acceptance/vault.acceptance.test.ts` |
| P4 | `tenon/packages/app/e2e/acceptance/notes-f.spec.ts` | `cd tenon/packages/app && bunx playwright test e2e/acceptance/notes-f.spec.ts --workers=1` |
| P5 | `tenon/packages/core/test/harness-app-tools.acceptance.test.ts` | `cd tenon/packages/core && bun test test/harness-app-tools.acceptance.test.ts` |
| P5 | `tenon/packages/tenon/test/acceptance/app-tools.acceptance.test.ts` | `cd tenon/packages/tenon && bun test test/acceptance/app-tools.acceptance.test.ts` |
| P6 | `tenon/packages/app/e2e/acceptance/agent-writes.spec.ts` | `cd tenon/packages/app && bunx playwright test e2e/acceptance/agent-writes.spec.ts --workers=1` |
| P7 | `tenon/packages/app/e2e/acceptance/command-centre.spec.ts` | `cd tenon/packages/app && bunx playwright test e2e/acceptance/command-centre.spec.ts --workers=1` |
| P7 | `tenon/packages/tenon/test/acceptance/command-centre.acceptance.test.ts` | `cd tenon/packages/tenon && bun test test/acceptance/command-centre.acceptance.test.ts` |
| P8 | `tenon/packages/desktop/src/main/mail/mail.acceptance.test.ts` | `cd tenon/packages/desktop && bun test src/main/mail/mail.acceptance.test.ts` |
| P8 | `tenon/packages/tenon/test/acceptance/mail-tools.acceptance.test.ts` | `cd tenon/packages/tenon && bun test test/acceptance/mail-tools.acceptance.test.ts` |
| P9 | `tenon/packages/tenon/test/acceptance/routines.acceptance.test.ts` | `cd tenon/packages/tenon && bun test test/acceptance/routines.acceptance.test.ts` |
| P9 | `tenon/packages/app/e2e/acceptance/routines.spec.ts` | `cd tenon/packages/app && bunx playwright test e2e/acceptance/routines.spec.ts --workers=1` |

Each PR's base commit adds the rows' files for its phases.

Not automated (manual evidence): AC-2.4's desktop mic button and AC-2.5's Settings tab (desktop-only UI; verifier reviews the code and a screenshot), real transcription, AC-8.5 Settings › Accounts, real mail accounts.

## Baseline (2026-11-02, commit 5917c3b3)

| Test | Result | Why |
| --- | --- | --- |
| AC-1.1 | fail | container has no outline (intended) |
| AC-1.2 | fail | container has no width transition (intended) |
| AC-1.3 | pass | no transition exists yet; must stay 0 under reduced motion |
| AC-1.4 | pass | existing rail order; must be preserved |
| AC-2.2, AC-2.3, AC-2.5 | fail | `./dictation` module and `THIRD_PARTY_NOTICES.md` don't exist (new module) |
| AC-2.1 | fail | crate doesn't exist (new package) |
| AC-2.4 (web) | pass | no mic button exists; must stay absent in the web build |
