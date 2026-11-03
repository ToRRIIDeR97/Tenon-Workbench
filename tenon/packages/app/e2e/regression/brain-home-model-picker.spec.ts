import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockTenonServer } from "../utils/mock-server"

const model = (id: string, name: string, isDefault: boolean) => ({
  id,
  name,
  reasoningEfforts: ["low", "medium", "high"],
  serviceTiers: [],
  defaultReasoningEffort: "low",
  isDefault,
})

test("Home starts a thread with the model and reasoning picked for its harness", async ({ page }) => {
  await mockTenonServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem(
        "tenon.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
    },
    { directory: fixture.directory },
  )
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        data: [
          { id: "opencode", driver: "opencode", name: "Default agent", status: "available", models: [] },
          {
            id: "codex",
            driver: "codex",
            name: "Codex",
            status: "available",
            models: [model("gpt-5.6-sol", "GPT-5.6 Sol", true), model("gpt-5.6-luna", "GPT-5.6 Luna", false)],
          },
        ],
      },
    }),
  )
  const created = Promise.withResolvers<Record<string, unknown>>()
  await page.route(
    (url) => url.pathname === "/api/session",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      created.resolve(route.request().postDataJSON())
      return route.fulfill({ status: 500, json: { name: "UnknownError", data: { message: "stop after create" } } })
    },
  )

  await page.goto("/")
  // One pill holds the harness, model and reasoning; each summary row opens its list.
  const pill = page.locator('[data-action="prompt-model-pill"]')
  const row = (step: string) => page.locator(`[data-component="prompt-model-pill-panel"] [data-step="${step}"]`)
  await pill.click()
  await row("harness").click()
  await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click()

  await expect(row("model")).toContainText("GPT-5.6 Sol")
  await row("model").click()
  await page.getByRole("menuitemradio", { name: "GPT-5.6 Luna", exact: true }).click()
  await expect(row("model")).toContainText("GPT-5.6 Luna")

  await expect(row("effort")).toContainText("low")
  await row("effort").click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(row("effort")).toContainText("high")
  await page.keyboard.press("Escape")
  await expect(pill).toHaveText("GPT-5.6 Luna · high")

  await page.getByRole("textbox", { name: "Start a Run", exact: true }).fill("Check the routes.")
  await page.getByRole("button", { name: "Start", exact: true }).click()

  expect(await created.promise).toMatchObject({
    harnessInstanceID: "codex",
    harnessModel: { id: "gpt-5.6-luna", reasoningEffort: "high" },
  })
})
