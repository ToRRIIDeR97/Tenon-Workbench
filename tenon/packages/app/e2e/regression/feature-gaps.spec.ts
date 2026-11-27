import { expect, test, type Page } from "@playwright/test"
import { brain, openApp } from "../acceptance/open-app"
import { fixture } from "../smoke/session-timeline.fixture"

const thread = {
  id: "ses_gap",
  slug: "ses_gap",
  projectID: fixture.project.id,
  directory: brain,
  title: "Gap thread",
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

type Seen = { method: string; path: string; body: unknown }

async function openThreadMenu(page: Page) {
  const seen: Seen[] = []
  await openApp(page, { sessions: [thread] })
  await page.route(/\/session\/ses_gap(\/[a-z]+)?(\?|$)/, async (route) => {
    const request = route.request()
    if (request.method() === "GET") return route.fallback()
    const body = request.postData() ? request.postDataJSON() : undefined
    seen.push({ method: request.method(), path: new URL(request.url()).pathname, body })
    const answer =
      request.method() === "DELETE"
        ? true
        : new URL(request.url()).pathname.endsWith("/fork")
          ? { ...thread, id: "ses_gap_fork", title: "Gap thread (fork)" }
          : { ...thread, ...(body as object) }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(answer),
    })
  })
  await page.goto("/")
  const group = page.locator('[data-component="second-brain-sidebar"]')
  await group.getByRole("button", { name: "General", exact: true }).click()
  const row = group.locator('[data-sidebar-thread="ses_gap"]')
  await expect(row.getByText("Gap thread", { exact: true })).toBeVisible()
  await row.hover()
  await row.getByRole("button", { name: "Thread actions" }).click()
  return { row, seen }
}

test("F-119 an unknown route falls back to Home", async ({ page }) => {
  await openApp(page)
  await page.goto("/no/such/page/here")
  await expect(page.locator('main [data-component="prompt-input-v2"]').first()).toBeVisible()
  await expect(page.locator('[data-sidebar-item="overview"]')).toHaveAttribute("aria-current", "page")
})

test("F-114 dragging a thread row onto the composer adds a reference to that thread", async ({ page }) => {
  await openApp(page, { sessions: [thread] })
  await page.goto("/")
  const sidebar = page.locator('[data-component="second-brain-sidebar"]')
  await sidebar.getByRole("button", { name: "General", exact: true }).click()
  const row = sidebar.locator('[data-sidebar-thread="ses_gap"]').first()
  await expect(row.getByText("Gap thread", { exact: true })).toBeVisible()
  const editor = page.locator('main [data-component="prompt-input"]').first()
  await expect(editor).toBeVisible()
  await row.dragTo(editor)
  await expect(editor).toContainText("@Gap thread")
})

test("F-301 an event made in the calendar's form is saved", async ({ page }) => {
  const saved: Array<{ events: Array<{ title: string; date: string }> }> = []
  await openApp(page)
  await page.route("**/second-brain/calendar**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname !== "/second-brain/calendar") return route.fallback()
    const reply = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      })
    if (request.method() === "PUT") {
      const body = request.postDataJSON()
      saved.push(body)
      return reply({ version: 2, revision: `r${saved.length + 1}`, events: body.events, tasks: body.tasks ?? [] })
    }
    return reply({ version: 2, revision: "r1", events: [], tasks: [] })
  })
  await page.goto("/calendar")
  await page.getByRole("button", { name: "New event" }).first().click()
  await page.locator("#calendar-event-title").fill("Dentist")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect.poll(() => saved.flatMap((body) => body.events.map((event) => event.title))).toContain("Dentist")
  await expect(page.getByText("Dentist").first()).toBeVisible()
})

test("F-618 the thread's Environment window opens from its toggle and closes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, { sessions: [thread] })
  await page.goto(`/${Buffer.from(brain).toString("base64url")}/session/ses_gap`)
  const window = page.locator('[data-component="thread-environment"]')
  const toggle = page.getByRole("button", { name: "Environment" }).first()
  await expect(toggle).toBeVisible()
  if (!(await window.isVisible())) await toggle.click()
  await expect(window).toBeVisible()
  for (const label of ["Harness", "Folder", "Branch", "Approvals", "Connectors", "Subagents", "Terminals"])
    await expect(window).toContainText(label)
  await window.getByRole("button", { name: "Close" }).click()
  await expect(window).toBeHidden()
  await toggle.click()
  await expect(window).toBeVisible()
  await window.focus()
  await page.keyboard.press("Escape")
  await expect(window).toBeHidden()
})

test("F-113 pinning from the thread menu saves the pin", async ({ page }) => {
  const { seen } = await openThreadMenu(page)
  await page.getByRole("menuitem", { name: "Pin" }).click()
  await expect.poll(() => seen.map((item) => item.method)).toContain("PATCH")
  const patch = seen.find((item) => item.method === "PATCH")!
  expect(patch.path).toMatch(/\/session\/ses_gap$/)
  expect(JSON.stringify(patch.body)).toMatch(/pin/i)
})

test("F-113 forking from the thread menu asks the server for a fork", async ({ page }) => {
  const { seen } = await openThreadMenu(page)
  await page.getByRole("menuitem", { name: "Fork" }).click()
  await expect
    .poll(() => seen.map((item) => `${item.method} ${item.path}`))
    .toContainEqual(expect.stringMatching(/^POST .*\/session\/ses_gap\/fork$/))
})

test("F-113 deleting from the thread menu removes the thread", async ({ page }) => {
  const { row, seen } = await openThreadMenu(page)
  await page.getByRole("menuitem", { name: "Delete" }).click()
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Delete" })
  if (await confirm.isVisible()) await confirm.click()
  await expect
    .poll(() => seen.map((item) => `${item.method} ${item.path}`))
    .toContainEqual(expect.stringMatching(/^DELETE .*\/session\/ses_gap$/))
  await expect(row).toHaveCount(0)
})
