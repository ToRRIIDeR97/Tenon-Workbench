import base from "./playwright.config"

const workers = process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : "50%"

export default {
  ...base,
  fullyParallel: true,
  workers,
}
