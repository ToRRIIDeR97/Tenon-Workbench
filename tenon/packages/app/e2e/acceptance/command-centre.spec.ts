import { expect, test, type Page } from "@playwright/test"
import { brain, openApp, sidebar } from "./open-app"

// P7 · Command Centre (implementations/notes-command-centre/implementation.md, AC-7.1, AC-7.2, AC-7.3, AC-7.4, AC-7.7)

const vaultRoot = "C:/Users/me/Documents/Tenon"
const commandDirectory = `${vaultRoot}/.command-centre`
const commandThread = {
  id: "ses_command_1",
  slug: "ses_command_1",
  projectID: "global",
  directory: commandDirectory,
  title: "Plan the billing webhook work",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000300000 },
}
const projectThread = {
  id: "ses_project_1",
  slug: "ses_project_1",
  projectID: "proj_acme",
  directory: `${brain}/projects/Acme`,
  title: "Cookie migration",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

async function start(page: Page, events: unknown[] = []) {
  await openApp(page, { sessions: [commandThread, projectThread], events: () => events.splice(0, 1), eventRetry: 16 })
  await page.route("**/second-brain/vault", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ root: vaultRoot, workspace: { id: "ws", name: "brain", folder: "brain" } }),
    }),
  )
}
const strip = (page: Page) => page.locator("[data-command-strip]")
// The app picks Ctrl or Cmd from navigator.platform, which the "Desktop Chrome" device reports as Win32 on any host.
const toggleStrip = async (page: Page) => {
  const mac = await page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
  await page.keyboard.press(mac ? "Meta+j" : "Control+j")
}

test.use({ viewport: { width: 1360, height: 860 } })

test("AC-7.1 the rail's fourth destination is Command Centre and /activity redirects", async ({ page }) => {
  await start(page)
  await page.goto("/")
  const ids = await sidebar(page)
    .locator("nav [data-sidebar-item]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-sidebar-item")))
  expect(ids).toEqual(["overview", "notes", "calendar", "command", "settings"])
  await sidebar(page).locator('[data-sidebar-item="command"]').click()
  await expect(page).toHaveURL(/\/command$/)
  await page.goto("/activity")
  await expect(page).toHaveURL(/\/command$/)
})

test("AC-7.2 the Command Centre lists only its own threads", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await expect(page.getByText("Plan the billing webhook work")).toBeVisible()
  await expect(page.getByRole("main").getByText("Cookie migration")).toHaveCount(0)
  await page.goto("/")
  await expect(sidebar(page).getByText("Plan the billing webhook work")).toHaveCount(0)
})

test("AC-7.3 Ctrl/Cmd+J toggles the slim strip; Esc hides it; Open full goes to the thread", async ({ page }) => {
  await start(page)
  await page.goto("/calendar")
  await expect(strip(page)).toHaveAttribute("data-state", "closed")
  const closed = await strip(page).evaluate((element) => element.getBoundingClientRect().height)
  expect(closed).toBeLessThanOrEqual(24)
  await toggleStrip(page)
  await expect(strip(page)).toHaveAttribute("data-state", "open")
  await expect.poll(() => strip(page).evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(90)
  await expect(strip(page).getByRole("textbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(strip(page)).toHaveAttribute("data-state", "closed")
  await toggleStrip(page)
  await strip(page).getByRole("button", { name: "Open full" }).click()
  await expect(page).toHaveURL(/\/command(\?thread=.*)?$/)
})

test("AC-7.3 the strip is not offered on the Command Centre page itself", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await toggleStrip(page)
  await expect(strip(page)).toHaveCount(0)
})

test("AC-7.3 the strip animates with the motion tokens", async ({ page }) => {
  await start(page)
  await page.goto("/notes")
  await toggleStrip(page)
  const opening = await strip(page)
    .locator("[data-command-strip-card]")
    .evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(opening).toContain("0.3s")
})

test("AC-7.4 memory age defaults to 45 days and lowering it warns", async ({ page }) => {
  await start(page)
  await page.goto("/")
  await sidebar(page).locator('[data-sidebar-item="settings"]').click()
  await page.getByRole("tab", { name: "Command Centre" }).click()
  const days = page.getByRole("spinbutton", { name: "Delete threads after (days)" })
  await expect(days).toHaveValue("45")
  await days.fill("10")
  await expect(page.getByText("Threads older than this are summarised and deleted for good.")).toBeVisible()
})

test("AC-7.7 writes in a Command Centre turn show one step list", async ({ page }) => {
  const write = (id: string, kind: string, phase: string) => ({
    directory: commandDirectory,
    payload: {
      id: `evt_${id}_${phase}`,
      type: "agent.write",
      properties: {
        id,
        sessionID: commandThread.id,
        kind,
        phase,
        target: "Acme API",
        preview: kind === "note" ? { title: "Plan", text: "Write it up" } : { tasks: [{ title: "Webhook retries" }] },
        ...(phase === "done" ? { undo: `undo_${id}` } : {}),
      },
    },
  })
  await start(page, [write("a", "note", "started"), write("a", "note", "done"), write("b", "tasks", "started"), write("b", "tasks", "done")])
  await page.goto(`/command?thread=${commandThread.id}`)
  const steps = page.locator('[data-agent-write][data-variant="steps"]')
  await expect(steps).toHaveCount(1)
  await expect(steps.getByRole("listitem")).toHaveCount(2)
  // The open thread's writes show only in the step list, never as the top pill as well. Counted once, right
  // after the steps render: a pill would render from the same writes and hides itself after 6 s, so a
  // retrying assertion could pass by waiting it out.
  expect(await page.locator('[data-agent-write][data-variant="pill"]').count()).toBe(0)
})
