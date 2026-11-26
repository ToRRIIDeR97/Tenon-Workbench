import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockTenonServer } from "../utils/mock-server"

test("Harness picker lists the built-in loop first, then external agents, with an add action", async ({
  page,
}, testInfo) => {
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
  const harness = (id: string, driver: string, name: string) => ({ id, driver, name, status: "available", models: [] })
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        data: [
          harness("codex", "codex", "Codex"),
          harness("opencode", "opencode", "Default agent"),
          harness("opencode-acp", "acp", "OpenCode"),
          harness("claude-code", "acp", "Claude Code"),
          harness("custom-agent", "acp", "Custom Agent"),
        ],
      },
    }),
  )

  await page.goto("/")
  const pill = page.locator('main [data-component="prompt-input-v2"] [data-action="prompt-model-pill"]')
  await expect(pill).toBeEnabled()
  await pill.click()
  await page.locator('[data-component="prompt-model-pill-panel"] [data-step="harness"]').click()

  const list = page.locator('[data-component="prompt-model-pill-panel"]')
  const order = ["Default agent", "Codex", "OpenCode", "Claude Code", "Custom Agent", "Add harness"]
  const items = list.getByRole("menuitemradio")
  await expect(items).toHaveCount(order.length)
  for (const [index, name] of order.entries()) await expect(items.nth(index)).toHaveAccessibleName(name)
  const add = list.getByRole("menuitemradio", { name: "Add harness", exact: true })
  await page.screenshot({ path: testInfo.outputPath("harness-picker-groups.png") })

  await add.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Harnesses" })).toHaveAttribute("aria-selected", "true")
})
