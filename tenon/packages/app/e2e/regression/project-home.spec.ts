import { expect, test, type Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockTenonServer } from "../utils/mock-server"
import type { LogEntry, ProjectRecord, TimelineItem } from "../../src/features/second-brain/client"

// The Project page as one column: cover and tile, the milestone road, the numbers row, then Tasks, Story, Pages and
// Settings with a section index.
type Log = LogEntry[] | { fail: number; entries: LogEntry[] }

async function setup(page: Page, items: TimelineItem[], log: Log, clock: "fixed" | "running" = "fixed") {
  // Fixed for most tests; running where a test needs time to pass on the page.
  if (clock === "fixed") await page.clock.setFixedTime(NOW)
  else await page.clock.install({ time: NOW })
  await mockTenonServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: {} }))
    localStorage.setItem(
      "tenon.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
    )
  }, fixture.directory)
  const date = new Date().toLocaleDateString("en-CA")
  const project: ProjectRecord = {
    id: "project_home",
    folder: "projects/project_home",
    name: "Home Project",
    outcome: "Ship the new Project page",
    instructions: "",
    status: "active",
    progressPercent: 0,
    blocker: "Waiting on review",
    tags: [],
    createdAt: date,
    updatedAt: date,
  }
  // A log that fails its first `fail` reads, then answers.
  const logState = Array.isArray(log) ? { fail: 0, entries: log } : { ...log }
  await page.route("**/second-brain/**", async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith("/second-brain/")) return route.fallback()
    if (url.pathname === "/second-brain/projects") return route.fulfill({ json: [project] })
    if (url.pathname === "/second-brain/project-threads")
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
    if (url.pathname === "/second-brain/project") {
      if (route.request().method() === "PATCH") Object.assign(project, route.request().postDataJSON())
      return route.fulfill({ json: project })
    }
    if (url.pathname === "/second-brain/vault/pages")
      return route.fulfill({
        json: [
          {
            id: "page_notes",
            path: "Home Project/Notes.md",
            title: "Design notes",
            projectId: project.id,
            properties: {},
            updatedAt: date,
          },
        ],
      })
    if (url.pathname === "/second-brain/vault/timeline")
      return route.fulfill({ json: { projectId: project.id, revision: "1", items, progress: 0 } })
    if (url.pathname === "/second-brain/vault/log") {
      if (logState.fail > 0) {
        logState.fail -= 1
        return route.fulfill({ status: 500, json: { data: { message: "broken" } } })
      }
      return route.fulfill({ json: logState.entries })
    }
    if (url.pathname === "/second-brain/vault/conflicts") return route.fulfill({ json: [] })
    return route.fulfill({ status: 404, json: {} })
  })
}

const items: TimelineItem[] = [
  { id: "m1", title: "Alpha", kind: "milestone", status: "todo", start: "2026-11-14" },
  { id: "t1", title: "Dump the page", kind: "task", status: "done" },
  { id: "m2", title: "Beta", kind: "milestone", status: "todo", start: "2026-12-04" },
  { id: "t2", title: "Pick a layout", kind: "task", status: "done" },
  { id: "t3", title: "Build the column", kind: "task", status: "todo" },
  { id: "m3", title: "Release", kind: "milestone", status: "todo", start: "2026-12-12" },
  { id: "t4", title: "Release notes", kind: "task", status: "todo" },
]
// The page's clock is pinned to midday, so "Today" holds whenever the suite runs.
const NOW = new Date(2026, 10, 23, 12, 0)
const note = (minutesAgo: number, text: string): LogEntry => ({
  at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  author: "agent",
  text,
  machine: "m",
})
const number = (page: Page, key: string) =>
  page.locator(`[data-project-numbers] [data-project-number="${key}"] [data-count-value]`)

test("the Project page shows its road, numbers and story, and old log links land on Story", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await setup(page, items, [note(1, "Started the one-column Project page.")])
  await page.goto("/projects?project=project_home")

  const road = page.getByRole("list", { name: "Milestones" })
  await expect(road.getByRole("listitem")).toHaveCount(3)
  await expect(road.locator('[data-road-stop="done"]')).toContainText("Alpha")
  const current = road.locator('[aria-current="step"]')
  await expect(current).toContainText("Beta")
  await expect(current).toContainText("Current milestone, 1 of 2 tasks done")
  await expect(number(page, "open")).toHaveText("2")
  await expect(number(page, "done")).toHaveText("2")
  await expect(number(page, "running")).toHaveText("0")
  await expect(number(page, "pages")).toHaveText("1")
  await expect(page.locator("[data-project-numbers] [data-project-number='open'] [data-count-shown]")).toHaveText("2")
  await expect(page.locator("[data-project-blocker-chip]")).toContainText("Waiting on review")

  const story = page.getByRole("region", { name: "Story" })
  // Below the fold on open, so the section links' landing on Story below is a real scroll.
  await expect(story).not.toBeInViewport()
  await expect(story.locator('[data-story-entry="milestone"]')).toContainText("Beta")
  await expect(story.locator('[data-story-entry="log"]')).toHaveText(/Started the one-column Project page\./)
  await expect(story.getByRole("heading", { name: "Today", exact: true })).toBeVisible()
  // What was there when the page opened doesn't slide in; only later arrivals do.
  await expect(story.locator("[data-entering]")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Design notes/ })).toBeVisible()
  const index = page.getByRole("navigation", { name: "Project sections" })
  await expect(index).toBeVisible()
  await expect(index.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "location")
  await page.screenshot({ path: testInfo.outputPath("project-home.png") })

  // Scrolled to the end by the wheel, the short last section is the current one; back at the top, Tasks is again.
  await page.getByRole("heading", { name: "Home Project", level: 1 }).hover()
  await page.mouse.wheel(0, 20_000)
  await expect(index.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "location")
  await page.mouse.wheel(0, -20_000)
  await expect(index.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "location")

  // Agent-write cards still link to `section=log`, and older links to `section=threads`; both open on Story.
  await page.goto("/projects?project=project_home&section=log")
  await expect(page.getByRole("region", { name: "Story" })).toBeInViewport()
  await page.goto("/projects?project=project_home&section=threads")
  await expect(page.getByRole("region", { name: "Story" })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath("project-home-story.png") })
})

test("a failed log keeps Story open with a retry, and long stories fold", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const many = Array.from({ length: 14 }, (_, index) => note(index + 1, `Note ${index + 1}`))
  await setup(page, items, { fail: 1, entries: many })
  await page.goto("/projects?project=project_home")
  const story = page.getByRole("region", { name: "Story" })
  const failed = story.getByRole("alert")
  await expect(failed).toHaveText(/The Project log couldn't load\./)
  // The milestone ahead and New thread stay while the log is down.
  await expect(story.locator('[data-story-entry="milestone"]')).toContainText("Beta")
  await expect(story.getByRole("button", { name: "New thread", exact: true })).toBeVisible()

  await failed.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(story.locator('[data-story-entry="log"]')).toHaveCount(12)
  await expect(failed).toHaveCount(0)
  await story.getByRole("button", { name: "Show older", exact: true }).click()
  await expect(story.locator('[data-story-entry="log"]')).toHaveCount(14)
  await expect(story.getByRole("button", { name: "Show less", exact: true })).toBeVisible()
})

test("an entry that arrives after the page opened slides in, once, and Show older doesn't replay it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const older = Array.from({ length: 13 }, (_, index) => note(index + 1, `Older ${index + 1}`))
  // Stamped half a minute after the page opens; the log only answers on Try again.
  const arrival: LogEntry = { ...note(0, "Arrived after open"), at: new Date(NOW.getTime() + 30_000).toISOString() }
  await setup(page, items, { fail: 1, entries: [arrival, ...older] }, "running")
  await page.goto("/projects?project=project_home")
  const story = page.getByRole("region", { name: "Story" })
  const failed = story.getByRole("alert")
  await expect(failed).toBeVisible()
  // Let the page's minute clock pass the arrival's stamp, then load the log.
  await page.clock.fastForward(61_000)
  await failed.getByRole("button", { name: "Try again", exact: true }).click()
  const entering = story.locator("[data-entering]")
  await expect(entering).toHaveCount(1)
  await expect(entering).toHaveText(/Arrived after open/)
  await story.getByRole("button", { name: "Show older", exact: true }).click()
  await expect(story.locator('[data-story-entry="log"]')).toHaveCount(14)
  await expect(entering).toHaveCount(1)
})

test("a narrow page hides the index and keeps the road's key labels", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await setup(page, items, [])
  await page.goto("/projects?project=project_home")
  const road = page.getByRole("list", { name: "Milestones" })
  await expect(road.getByRole("listitem")).toHaveCount(3)
  await expect(road.locator('[aria-current="step"]').getByText("Beta", { exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Project sections" })).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath("project-home-narrow.png"), fullPage: true })
})

test("an empty road's Milestone button switches the add row to milestones", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await setup(page, [], [])
  await page.goto("/projects?project=project_home")
  const empty = page.locator('[data-project-road="empty"]')
  await expect(empty).toBeVisible()
  await expect(page.getByText("Nothing yet. Threads and log entries for this Project show up here.")).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("project-home-empty.png") })
  await empty.getByRole("button", { name: "Milestone", exact: true }).click()
  const add = page.getByRole("textbox", { name: "Add a task" })
  await expect(add).toBeFocused()
  await expect(add).toHaveAttribute("placeholder", "Add a milestone, press Enter")
})
