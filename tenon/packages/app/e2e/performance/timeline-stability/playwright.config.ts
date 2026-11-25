import { availableParallelism } from "node:os"
import config from "../playwright.config"

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
