import base from "./playwright.config"

// Parallel local e2e runs: spread every test (not just every file) across workers. Tests are
// isolated (each mocks its own server per page), so they are safe to run in any order.
// It keeps the dev server: dev builds talk to the mocked server on VITE_TENON_SERVER_PORT, while a
// production build talks to its own origin (src/entry.tsx), which the e2e mocks do not serve.
// Half the cores by default leaves room for the browsers and the dev server; on a small machine
// set PLAYWRIGHT_WORKERS=1 if timing-sensitive tests start to flake.
const workers = process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : "50%"

export default {
  ...base,
  fullyParallel: true,
  workers,
}
