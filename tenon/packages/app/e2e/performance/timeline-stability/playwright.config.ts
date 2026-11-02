import { availableParallelism } from "node:os"
import config from "../playwright.config"

// These specs check layout contracts, not speed, so they run in parallel against the one production build:
// half the cores, at most 6. PLAYWRIGHT_WORKERS overrides it; set it to 1 for the old serial run.
const workers =
  Number(process.env.PLAYWRIGHT_WORKERS) || Math.min(6, Math.max(1, Math.floor(availableParallelism() / 2)))

export default {
  ...config,
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../../test-results/timeline-stability",
  reporter: [["html", { outputFolder: "../../playwright-report/timeline-stability", open: "never" }], ["line"]],
  retries: 0,
  fullyParallel: true,
  workers,
  use: {
    ...config.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
}
