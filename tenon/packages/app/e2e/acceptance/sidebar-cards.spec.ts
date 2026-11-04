import { expect, test, type Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import type { MockServerConfig } from "../utils/mock-server"
import { openApp, sidebar } from "./open-app"

// implementations/sidebar-folder-cards: Group by, cards, status marks and the top line.

const repo = "C:/OpenCode/Repo"
const project = {
  project: {
    id: "prj_repo",
    folder: "projects/prj_repo",
    name: "Repo project",
    outcome: "Ship it",
    instructions: "",
    status: "active",
    progressPercent: 0,
    tags: [],
    location: { workspaceId: "proj_repo", displayPath: repo },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  threadDirectory: repo,
  threadDirectoryKind: "workspace",
  workspace: { id: "proj_repo", worktree: repo },
  rootSessionCount: 2,
  lastActivityAt: null,
}

const thread = (id: string, directory: string, updated: number) => ({
  id,
  slug: id,
  projectID: fixture.project.id,
  directory,
  title: id,
  version: "dev",
  time: { created: updated, updated },
})

const sessions = () => [
  thread("ses_busy", repo, Date.now()),
  thread("ses_quiet", fixture.directory, Date.now() - 3 * 86_400_000),
]

const open = (page: Page, input: Partial<MockServerConfig> = {}) =>
  openApp(page, {
    sessions: sessions(),
    projectThreads: [project],
    sessionStatus: { ses_busy: { type: "busy" } },
    ...input,
  })

const groupBy = (page: Page) => sidebar(page).getByRole("group", { name: "Group by" })
const card = (page: Page, id: string) => sidebar(page).locator(`[data-sidebar-card="${id}"]`)
const cardIDs = (page: Page) =>
  sidebar(page)
    .locator("[data-sidebar-card]")
    .evaluateAll((cards) => cards.map((item) => item.getAttribute("data-sidebar-card")))

test.use({ viewport: { width: 1280, height: 800 } })

test("Project mode shows a rounded card per Project and one for the workspace, in today's order", async ({ page }) => {
  await open(page)
  await page.goto("/")
  await expect(groupBy(page).getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true")
  await expect(sidebar(page).locator('[data-sidebar-project="prj_repo"][data-sidebar-card]')).toBeVisible()
  await expect(sidebar(page).locator('[data-sidebar-group="__brain__"][data-sidebar-card]')).toBeVisible()
  await expect.poll(() => cardIDs(page)).toEqual(["prj_repo", "__brain__"])
  const style = await card(page, "prj_repo").evaluate((element) => {
    const css = getComputedStyle(element)
    return { radius: parseFloat(css.borderTopLeftRadius), overflow: css.overflowX, position: css.position }
  })
  expect(style).toEqual({ radius: 16, overflow: "hidden", position: "relative" })
})

test("Group by switches between the three modes", async ({ page }) => {
  await open(page)
  await page.goto("/")
  await groupBy(page).getByRole("button", { name: "Attention" }).click()
  await expect.poll(() => cardIDs(page)).toEqual(["attention:running", "attention:other"])
  await expect(card(page, "attention:running").getByRole("button", { name: /^Running/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  )

  await groupBy(page).getByRole("button", { name: "Recent" }).click()
  await expect.poll(() => cardIDs(page)).toEqual(["recent:today", "recent:earlier"])

  await groupBy(page).getByRole("button", { name: "Project" }).click()
  await expect.poll(() => cardIDs(page)).toEqual(["prj_repo", "__brain__"])
})

test("the choice survives a reload", async ({ page }) => {
  await open(page)
  await page.goto("/")
  await groupBy(page).getByRole("button", { name: "Recent" }).click()
  await expect(card(page, "recent:today")).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage["tenon.window.browser.dat:sidebar"] ?? "{}").grouping))
    .toBe("recent")

  await page.reload()
  await expect(groupBy(page).getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true")
  await expect(card(page, "recent:today")).toBeVisible()
})

test("a stored value that isn't a mode falls back to Project", async ({ page }) => {
  await open(page)
  await page.addInitScript(() => {
    localStorage.setItem("tenon.window.browser.dat:sidebar", JSON.stringify({ grouping: "kanban" }))
  })
  await page.goto("/")
  await expect(groupBy(page).getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true")
  await expect(card(page, "prj_repo")).toBeVisible()
})

for (const [mode, id, thread] of [
  ["Attention", "attention:other", "ses_quiet"],
  ["Recent", "recent:today", "ses_busy"],
] as const) {
  test(`a thread opens from ${mode}`, async ({ page }) => {
    await open(page)
    await page.goto("/")
    await groupBy(page).getByRole("button", { name: mode }).click()
    await card(page, id).locator(`[data-sidebar-thread="${thread}"] [data-sidebar-thread-open]`).click()
    await expect(page).toHaveURL(new RegExp(thread))
    await expect(card(page, id).locator(`[data-sidebar-thread="${thread}"]`)).toHaveAttribute("data-selected", "")
  })
}

test("a thread opens from Project", async ({ page }) => {
  await open(page)
  await page.goto("/")
  await card(page, "prj_repo")
    .getByRole("button", { name: /^Repo project/ })
    .click()
  await card(page, "prj_repo").locator('[data-sidebar-thread="ses_busy"] [data-sidebar-thread-open]').click()
  await expect(page).toHaveURL(/ses_busy/)
})

test("a collapsed card shows the running mark and the top line, and names the count", async ({ page }) => {
  await open(page)
  await page.goto("/")
  const repoCard = sidebar(page).getByRole("group", { name: "Repo project, 1 running" })
  await expect(repoCard).toBeVisible()
  await expect(repoCard.getByRole("button", { name: /^Repo project/ })).toHaveAttribute("aria-expanded", "false")
  await expect(repoCard.getByRole("img", { name: "Running" })).toBeVisible()
  const line = repoCard.locator(".sidebar-card-line")
  await expect(line).toHaveAttribute("aria-hidden", "true")
  await expect.poll(() => line.evaluate((element) => getComputedStyle(element).animationName)).toBe("sidebar-card-line")
  await expect(card(page, "__brain__").locator(".sidebar-card-line")).toHaveCount(0)
  await expect(card(page, "__brain__").getByRole("img")).toHaveCount(0)
})

test("a row shows its state, idle shows nothing, and the sidebar no longer pulses", async ({ page }) => {
  await open(page)
  await page.goto("/")
  await groupBy(page).getByRole("button", { name: "Attention" }).click()
  const row = sidebar(page).locator('[data-sidebar-thread="ses_busy"]')
  await expect(row.getByRole("img", { name: "Running" })).toBeVisible()
  await expect(sidebar(page).locator(".running-pulse")).toHaveCount(0)
  await expect(sidebar(page).locator('[data-sidebar-thread="ses_quiet"]').getByRole("img")).toHaveCount(0)
})

test("an approval on a child that was never listed moves its root to Needs you", async ({ page }) => {
  const child = { ...thread("ses_child", fixture.directory, Date.now()), parentID: "ses_quiet" }
  const asked = {
    directory: fixture.directory,
    payload: {
      type: "permission.asked",
      properties: {
        id: "per_child",
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
      },
    },
  }
  const events = [asked]
  await open(page, { sessions: [...sessions(), child], events: () => events.splice(0, 1), eventRetry: 16 })
  await page.addInitScript(() => {
    localStorage.setItem("tenon.window.browser.dat:sidebar", JSON.stringify({ grouping: "attention" }))
  })
  await page.goto("/")

  const needs = card(page, "attention:needs")
  await expect(
    needs.locator('[data-sidebar-thread="ses_quiet"]').getByRole("img", { name: "Waiting for approval" }),
  ).toBeVisible()
  await expect(
    needs.getByRole("button", { name: /^Needs you/ }).getByRole("img", { name: "Waiting for approval" }),
  ).toBeVisible()
  await expect(card(page, "attention:other")).toHaveCount(0)
})

test("a status change keeps the other rows and an open menu", async ({ page }) => {
  const events: unknown[] = []
  // The app re-reads statuses on each reconnect, so the mock's answer has to change along with the event.
  const statuses = { ses_busy: { type: "busy" } }
  await open(page, { sessionStatus: statuses, events: () => events.splice(0, 1), eventRetry: 16 })
  await page.addInitScript(() => {
    localStorage.setItem("tenon.window.browser.dat:sidebar", JSON.stringify({ grouping: "attention" }))
  })
  await page.goto("/")
  const row = card(page, "attention:other").locator('[data-sidebar-thread="ses_quiet"]')
  await row.hover()
  await row.getByRole("button", { name: "Thread actions" }).click()
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await row.evaluate((element) => element.setAttribute("data-same-row", ""))

  statuses.ses_busy = { type: "idle" }
  events.push({
    directory: repo,
    payload: { type: "session.status", properties: { sessionID: "ses_busy", status: { type: "idle" } } },
  })

  await expect(card(page, "attention:running")).toHaveCount(0)
  await expect(row).toHaveAttribute("data-same-row", "")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
})

test("with reduced motion the line is still and full width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await open(page)
  await page.goto("/")
  const line = card(page, "prj_repo").locator(".sidebar-card-line")
  await expect(line).toBeVisible()
  const style = await line.evaluate((element) => {
    const parent = element.parentElement?.getBoundingClientRect().width
    return {
      animation: getComputedStyle(element).animationName,
      full: Math.abs(element.getBoundingClientRect().width - (parent ?? 0)) < 1,
    }
  })
  expect(style).toEqual({ animation: "none", full: true })
})
