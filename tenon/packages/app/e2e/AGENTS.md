## Required Reading

- Before writing, changing, or reviewing E2E tests, ALWAYS read and follow Playwright's official [Best Practices](https://playwright.dev/docs/best-practices), [Auto-waiting](https://playwright.dev/docs/actionability), and [Assertions](https://playwright.dev/docs/test-assertions) guides.
- Use the official [Locators](https://playwright.dev/docs/locators), [Network](https://playwright.dev/docs/network), and [Test Isolation](https://playwright.dev/docs/browser-contexts) guides when those concerns apply.

## Test Hygiene

- Test user-visible behavior with isolated, deterministic data and scoped, unique locators.
- Prefer role, label, text, and explicit test-contract locators. Do not use `.first()` or `.last()` merely to silence strictness errors.
- Use locator actions, Playwright auto-waiting, and web-first assertions for observable readiness and outcomes.
- NEVER use `waitForTimeout`, `setTimeout`, sleeps, animation-frame counts, or other wall-clock delays to synchronize a test. Wait for the specific UI state, request, response, event, or application outcome instead.
- Do not treat navigation, a network response, DOM attachment, or visibility alone as proof that asynchronously rendered UI is ready. Assert the state the next action actually requires.
- Register event and network waits before the action that triggers them.
- Do not retry state-changing actions. Retry idempotent readiness checks, then perform the action once and assert its outcome.
- Keep action and assertion timeouts adaptive. Do not use short timeouts as readiness probes or rely on retries to hide flakes.
- Assert exact outcomes and identities so stale state, duplicate rendering, and interactions with the wrong element cannot pass.

## Running and platforms

- `bun run test:e2e` runs against the dev server and parallelizes by file. `bun run test:e2e:fast` uses `playwright.fast.config.ts`: the same dev server, with individual tests (not just files) spread across half the CPU cores, so large spec files no longer hold one worker. Keep it to machines with spare cores and run nothing else heavy alongside it; on a small machine use `PLAYWRIGHT_WORKERS=1` if timing-sensitive tests start to flake. Specs must target the dev server: dev builds talk to the mocked server on `VITE_TENON_SERVER_PORT`, while a production build talks to its own origin.
- Tests run on every OS by default. Tag a test with `@windows`, `@macos` or `@linux` (`test("…", { tag: "@windows" }, …)`) only when it needs that real OS, such as a native shell, file dialog or font rendering; `playwright.config.ts` skips tags for other platforms. Cover path differences with `path.win32`/`path.posix` style fixtures in untagged tests instead, so both run on any machine.
- Wait for page transitions by state (`main > [data-component="view-switch-v2"]` reaching `data-phase="idle"`), not by time, when a test navigates again immediately after a page change.
