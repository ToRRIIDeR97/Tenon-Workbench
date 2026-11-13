import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@tenon/core/util/encode"
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

async function start(page: Page, events: unknown[] = [], input: Parameters<typeof openApp>[1] = {}) {
  await openApp(page, {
    sessions: [commandThread, projectThread],
    events: () => events.splice(0, 1),
    eventRetry: 16,
    ...input,
  })
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
  expect(ids).toEqual(["overview", "projects", "calendar", "command", "settings"])
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

// implementations/command-centre-thread/implementation.md, AC-2 and AC-3
const threadURL = new RegExp(`/session/${commandThread.id}$`)

test("AC-3 a Command Centre thread opens in the thread view, as do older ?thread= links", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await page.getByRole("link", { name: /Plan the billing webhook work/ }).click()
  await expect(page).toHaveURL(threadURL)
  await page.goto(`/command?thread=${commandThread.id}`)
  await expect(page).toHaveURL(threadURL)
})

test("AC-3 the Command Centre composer has the model pill", async ({ page }) => {
  await start(page)
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: commandDirectory, project: { id: "global", directory: commandDirectory } },
        data: [{ id: "opencode", driver: "opencode", name: "Default agent", status: "available", models: [] }],
      },
    }),
  )
  await page.goto("/command")
  await expect(page.getByRole("textbox", { name: "Message the Command Centre", exact: true })).toBeVisible()
  await expect(page.locator('[data-action="prompt-model-pill"]')).toBeVisible()
})

test("AC-2 a Command Centre thread has no review or terminal controls", async ({ page }) => {
  await start(page)
  await page.goto(`/command?thread=${commandThread.id}`)
  await expect(page).toHaveURL(threadURL)
  await expect(page.locator('[data-component="prompt-input-v2"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Toggle terminal", exact: true })).toHaveCount(0)
})

test("AC-7.3 Ctrl/Cmd+J toggles the slim strip; Esc hides it; Open full goes to the thread", async ({ page }) => {
  await start(page)
  await page.goto("/calendar")
  await expect(strip(page)).toHaveAttribute("data-state", "closed")
  const closed = await strip(page).evaluate((element) => element.getBoundingClientRect().height)
  expect(closed).toBeLessThanOrEqual(24)
  await toggleStrip(page)
  await expect(strip(page)).toHaveAttribute("data-state", "open")
  await expect
    .poll(() => strip(page).evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThanOrEqual(90)
  await expect(strip(page).getByRole("textbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(strip(page)).toHaveAttribute("data-state", "closed")
  await toggleStrip(page)
  await strip(page).getByRole("button", { name: "Open full" }).click()
  await expect(page).toHaveURL(threadURL)
})

// One exchange in the Command Centre thread; the reply is Markdown with a list long enough to pass the card's cap.
const tasks = [
  "Duolingo",
  "Read Bible",
  "Buy tickets",
  "Call the bank",
  "Water plants",
  "File receipts",
  "Book dentist",
]
const exchange = [
  message("msg_command_ask", "user", "What's on my calendar today?"),
  message(
    "msg_command_reply",
    "assistant",
    ["You have no calendar events today. Tasks due:", "", ...tasks.map((task) => `- **${task}**: still open`)].join(
      "\n",
    ),
  ),
]

function message(id: string, role: "user" | "assistant", text: string) {
  return {
    info: {
      id,
      sessionID: commandThread.id,
      role,
      time: { created: 1762000100000, completed: 1762000200000 },
      agent: "build",
      model: { providerID: "opencode", modelID: "test" },
    },
    parts: [{ id: `prt_${id}`, sessionID: commandThread.id, messageID: id, type: "text", text }],
  }
}

test("the card draws the reply as Markdown under a cap, with Show more", async ({ page }) => {
  await start(page, [], { pageMessages: (id) => ({ items: id === commandThread.id ? exchange : [] }) })
  await page.goto("/")
  await toggleStrip(page)
  await expect(strip(page)).toHaveAttribute("data-state", "open")

  const reply = strip(page).locator('[data-slot="command-card-reply"]')
  await expect(reply.getByRole("listitem")).toHaveCount(tasks.length)
  await expect(reply.locator("strong").filter({ hasText: "Duolingo" })).toHaveCount(1)
  await expect(reply).not.toContainText("**")

  const capped = await reply.evaluate((element) => element.getBoundingClientRect().height)
  await strip(page).getByRole("button", { name: "Show more", exact: true }).click()
  await expect(reply).toHaveAttribute("data-expanded", "")
  await expect(strip(page).getByRole("button", { name: "Show less", exact: true })).toBeVisible()
  await expect.poll(() => reply.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(capped)
})

test("AC-7.3 the strip is not offered on the Command Centre page itself", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await toggleStrip(page)
  await expect(strip(page)).toHaveCount(0)
})

test("AC-7.3 the strip animates with the motion tokens", async ({ page }) => {
  await start(page)
  await page.goto("/projects")
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

test("AC-7.7 a Command Centre thread shows its writes as inline cards in the thread view", async ({ page }) => {
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
  await start(page, [
    write("a", "note", "started"),
    write("a", "note", "done"),
    write("b", "tasks", "started"),
    write("b", "tasks", "done"),
  ])
  // Open the thread view first: on any other page these writes would rightly show the top pill.
  await page.goto(`/${base64Encode(commandDirectory)}/session/${commandThread.id}`)
  await expect(page).toHaveURL(threadURL)
  // The thread view shows each write in its turn, as for a Project thread; never also as the top pill.
  const cards = page.locator('[data-agent-write][data-variant="inline"]')
  await expect(cards).toHaveCount(2)
  expect(await page.locator('[data-agent-write][data-variant="pill"]').count()).toBe(0)
})
