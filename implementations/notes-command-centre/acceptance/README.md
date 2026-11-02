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

Later phases add their rows when their tests are written (before each phase starts).

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
