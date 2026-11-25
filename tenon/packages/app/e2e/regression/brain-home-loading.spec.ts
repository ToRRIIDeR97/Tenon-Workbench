import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockTenonServer } from "../utils/mock-server"

test("Home remains usable during loading and reuses fresh harness availability", async ({ page }, testInfo) => {
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
  const now = new Date()
  await page.clock.setFixedTime(now)
  const date = await page.evaluate(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  })
  const projects = Promise.withResolvers<void>()
  const calendar = Promise.withResolvers<void>()
  const harness = Promise.withResolvers<void>()
  const refresh = Promise.withResolvers<void>()
  let harnessRequests = 0
  await page.route("**/api/harness?**", async (route) => {
    harnessRequests++
    await (harnessRequests === 1 ? harness.promise : refresh.promise)
    await route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        data: [{ id: "opencode", driver: "opencode", name: "OpenCode", status: "available", models: [] }],
      },
    })
  })
  await page.route("**/second-brain/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const project = {
      id: "project_loading",
      folder: "projects/loading",
      name: "Loading test project",
      outcome: "Responsive Home",
      instructions: "",
      status: "active",
      progressPercent: 25,
      tags: [],
      createdAt: date,
      updatedAt: date,
    }
    if (path === "/second-brain/projects") {
      await projects.promise
      return route.fulfill({ json: [project] })
    }
    if (path === "/second-brain/project-threads") {
      await projects.promise
      return route.fulfill({
        json: [
          {
            project,
            threadDirectory: `${fixture.directory}/${project.folder}`,
            threadDirectoryKind: "project",
            workspace: null,
            rootSessionCount: 0,
            lastActivityAt: null,
          },
        ],
      })
    }
    if (path === "/second-brain/calendar") {
      await calendar.promise
      return route.fulfill({
        json: {
          version: 2,
          revision: "1",
          events: [{ id: "event_loading", title: "Loading test event", date, source: "local", syncState: "local" }],
          tasks: [],
        },
      })
    }
    return route.fallback()
  })
  const home = page.getByRole("heading", { name: "Home", exact: true })
  const prompt = page.locator('main [data-component="prompt-input-v2"] [contenteditable="true"]')
  const selector = page.locator('[data-action="prompt-model-pill"]')
  const expectHarness = async (name: string) => {
    await selector.click()
    await expect(page.locator('[data-component="prompt-model-pill-panel"] [data-step="harness"]')).toContainText(name)
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-component="prompt-model-pill-panel"]')).toHaveCount(0)
  }
  const start = page.getByRole("button", { name: "Send", exact: true })
  try {
    await page.goto("/")
    await expect(home).toBeVisible()
    await prompt.fill("A draft while data loads")
    await expect(prompt).toContainText("A draft while data loads")
    await expect(start).toBeEnabled()
    await expect(page.getByText("Checking harnesses…", { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("home-pending.png"), fullPage: true })

    await page.locator('[data-sidebar-item="command"]').click()
    await expect(home).not.toBeVisible()
    await page.locator('[data-sidebar-item="overview"]').click()
    await expect(prompt).toBeEditable()
    await prompt.fill("Still usable")
    expect(harnessRequests).toBe(1)

    calendar.resolve()
    await expect(page.getByRole("button", { name: /Loading test event/ })).toBeVisible()
    projects.resolve()
    await expect(
      page.getByRole("region", { name: "Home", exact: true }).getByRole("button", { name: /Loading test project/ }),
    ).toBeVisible()
    await expect(start).toBeEnabled()
    harness.resolve()
    await expect(selector).toBeEnabled()
    await expectHarness("OpenCode")
    await expect(start).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath("home-loaded.png"), fullPage: true })

    await page.locator('[data-sidebar-item="command"]').click()
    await expect(home).not.toBeVisible()
    await page.locator('[data-sidebar-item="overview"]').click()
    await expect(selector).toBeEnabled()
    await expectHarness("OpenCode")
    expect(harnessRequests).toBe(1)

    await page.clock.setFixedTime(new Date(now.getTime() + 31_000))
    await page.locator('[data-sidebar-item="command"]').click()
    await expect(home).not.toBeVisible()
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/harness")
    await page.locator('[data-sidebar-item="overview"]').click()
    await requested
    await expect(selector).toBeEnabled()
    await expectHarness("OpenCode")
    await prompt.fill("A draft during background refresh")
    await expect(start).toBeEnabled()
    expect(harnessRequests).toBe(2)
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/harness")
    refresh.resolve()
    await refreshed
    await expect(selector).toBeEnabled()
  } finally {
    projects.resolve()
    calendar.resolve()
    harness.resolve()
    refresh.resolve()
  }
})
