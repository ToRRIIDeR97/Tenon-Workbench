import base from "./playwright.config"

// Faster local e2e runs: build the app once and serve the production bundle, then spread every
// test (not just every file) across workers. The dev server compiles each page on first request,
// which serializes workers behind it; the built bundle does not. Tests are isolated (each mocks
// its own server per page), so they are safe to run in any order.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
// Workers inherit this, so the e2e mock server (e2e/utils/mock-server.ts) recognises the app's port.
process.env.PLAYWRIGHT_PORT = String(port)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
// Half the cores by default leaves room for the browser and the preview server.
const workers = process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : "50%"

export default {
  ...base,
  fullyParallel: true,
  workers,
  webServer: {
    ...base.webServer,
    command: `bun run build && bun run serve -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    // Never attach to a dev server left running on the same port.
    reuseExistingServer: false,
    timeout: 300_000,
  },
  use: { ...base.use, baseURL },
}
