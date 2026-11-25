import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { brain, openApp } from "./open-app"

const directory = brain
const sessionID = "ses_live_canvas"
const userID = "msg_live_canvas_user"
const assistantID = "msg_live_canvas_assistant"
const partID = "prt_live_canvas_text"
const model = { providerID: "opencode", modelID: "claude-opus-4-6" }
const thread = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_live_canvas",
  directory,
  title: "Pricing page",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

const intro = "Here is a pricing page.\n\n"
const open = '```html canvas title="Pricing"\n<style>h1{font:600 32px system-ui}</style>\n'
const steps = [
  `${intro}${open}<main><h1>Pri`,
  `${intro}${open}<main><h1>Pricing</h1><p class="plan">Starter`,
  `${intro}${open}<main><h1>Pricing</h1><p class="plan">Starter</p><p class="plan">Team</p><p class="plan">Ent`,
  `${intro}${open}<main><h1>Pricing</h1><p class="plan">Starter</p><p class="plan">Team</p><p class="plan">Enterprise</p></main>\n<script>document.body.dataset.ran = "yes"</script>\n\`\`\`\n`,
]

const message = (role: "user" | "assistant", id: string, parts: Record<string, unknown>[]) => ({
  info: {
    id,
    sessionID,
    role,
    time: { created: role === "user" ? 1762000000000 : 1762000001000 },
    agent: "build",
    model,
    ...(role === "assistant"
      ? {
          parentID: userID,
          modelID: model.modelID,
          providerID: model.providerID,
          mode: "build",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
      : {}),
  },
  parts: parts.map((part) => ({ ...part, sessionID, messageID: id })),
})

const textPart = (text: string) => ({ id: partID, type: "text", text })
const partEvent = (index: number) => ({
  directory,
  payload: {
    type: "message.part.updated",
    properties: { part: { ...textPart(steps[index]!), sessionID, messageID: assistantID } },
  },
})

const completedEvent = () => {
  const info = message("assistant", assistantID, []).info
  return {
    directory,
    payload: {
      type: "message.updated",
      properties: { info: { ...info, time: { ...info.time, completed: 1762000009000 }, finish: "length" } },
    },
  }
}

const heartbeat = { directory: "global", payload: { type: "server.heartbeat", properties: {} } }

const base64 = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

const shots = process.env.LIVE_CANVAS_SHOTS
const shot = async (page: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, `${name}.png`) })
}

test.use({ viewport: { width: 1440, height: 900 } })

async function start(page: Page, history = intro) {
  const feed: unknown[] = []
  await openApp(page, {
    sessions: [thread],
    pageMessages: (id) =>
      id === sessionID
        ? {
            items: [
              message("user", userID, [{ id: "prt_live_canvas_user", type: "text", text: "Draw a pricing page" }]),
              message("assistant", assistantID, [textPart(history)]),
            ],
          }
        : { items: [] },
    events: () => (feed.length ? feed.splice(0, 1) : [heartbeat]),
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Here is a pricing page.")).toBeVisible()
  return feed
}

test("AC-9 … AC-11 a streaming canvas design opens large, draws live in one frame and settles", async ({ page }) => {
  const feed = await start(page)
  const view = page.locator('[data-canvas-design="live"]')
  await expect(view).toHaveCount(0)

  feed.push(partEvent(0), partEvent(1))
  await expect(view).toBeVisible()
  const status = view.locator('[data-slot="canvas-design-status"]')
  await expect(status).toHaveText("Drawing")
  await expect(view.getByRole("button", { name: "Use this one" })).toHaveCount(0)
  const frame = view.locator("iframe")
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts")
  const page1 = page.frameLocator('[data-canvas-design="live"] iframe')
  await expect(page1.locator("h1")).toHaveText("Pricing")
  await frame.evaluate((el) => el.setAttribute("data-e2e-first-frame", ""))

  feed.push(partEvent(2))
  await expect(page1.locator("p.plan")).toHaveText(["Starter", "Team", "Ent"])
  await shot(page, "1-drawing-preview")
  await expect(frame).toHaveAttribute("data-e2e-first-frame", "")
  const top = (await frame.boundingBox())?.y
  await expect(page1.locator("body")).not.toHaveAttribute("data-ran", "yes")

  await view.getByRole("button", { name: "Code" }).click()
  const code = view.locator('[data-slot="canvas-design-code"]')
  await expect(code).toBeVisible()
  await expect(code).toContainText('<p class="plan">Ent')
  await expect(code.locator('[data-slot="canvas-design-caret"]')).toBeVisible()
  await shot(page, "2-drawing-code")
  await view.getByRole("button", { name: "Preview" }).click()

  feed.push(partEvent(3))
  await expect(status).toHaveText("Drawn just now")
  await expect(view.getByRole("button", { name: "Use this one" })).toBeVisible()
  await expect(page1.locator("body")).toHaveAttribute("data-ran", "yes")
  await expect(page1.locator("p.plan")).toHaveText(["Starter", "Team", "Enterprise"])
  await expect(frame).toHaveAttribute("data-e2e-first-frame", "")
  expect((await frame.boundingBox())?.y).toBe(top)
  await shot(page, "3-done")

  await view.getByRole("button", { name: "All designs" }).click()
  await expect(view).toHaveCount(0)
  await expect(page.getByRole("button", { name: "View Pricing" })).toBeVisible()
})

test("AC-9 going back to the list while a design draws keeps the list", async ({ page }) => {
  const feed = await start(page)
  const view = page.locator('[data-canvas-design="live"]')
  feed.push(partEvent(0), partEvent(1))
  await expect(view).toBeVisible()
  await view.getByRole("button", { name: "All designs" }).click()
  await expect(view).toHaveCount(0)
  const card = page.getByRole("button", { name: "View Pricing" })
  const label = page.locator('[data-slot="board-label"]')
  await expect(card.locator("iframe")).toHaveCount(1)
  await expect(label).toContainText("Drawing…")

  feed.push(partEvent(2), partEvent(3))
  await expect(label).toContainText("Use this one")
  await expect(label).not.toContainText("Drawing…")
  await expect(card.locator("iframe")).toHaveCount(1)
  await expect(view).toHaveCount(0)
})

test("AC-9 a canvas design from history never opens the panel", async ({ page }) => {
  await start(page, steps[3])
  await expect(page.getByText("Design · Pricing")).toBeVisible()
  await expect(page.locator('[data-canvas-design="live"]')).toHaveCount(0)
  await expect(page.getByRole("button", { name: "View Pricing" })).toHaveCount(0)
})

test("AC-11 a reply that ends inside an open canvas fence settles with what it drew", async ({ page }) => {
  const feed = await start(page)
  const view = page.locator('[data-canvas-design="live"]')
  feed.push(partEvent(0), partEvent(1), partEvent(2))
  const preview = page.frameLocator('[data-canvas-design="live"] iframe')
  await expect(preview.locator("p.plan")).toHaveText(["Starter", "Team", "Ent"])
  const frame = view.locator("iframe")
  await frame.evaluate((el) => el.setAttribute("data-e2e-first-frame", ""))

  feed.push(completedEvent())
  await expect(view.locator('[data-slot="canvas-design-status"]')).toHaveText("Drawn just now")
  await expect(view.getByRole("button", { name: "Use this one" })).toBeVisible()
  await expect(frame).toHaveAttribute("data-e2e-first-frame", "")
  await expect(preview.locator("p.plan")).toHaveText(["Starter", "Team", "Ent"])

  await view.getByRole("button", { name: "All designs" }).click()
  const card = page.getByRole("button", { name: "View Pricing" })
  await expect(card.locator("iframe")).toHaveCount(1)
  await expect(page.locator('[data-slot="board-label"]')).toContainText("Use this one")
  await expect(page.locator('[data-slot="board-label"]')).not.toContainText("Drawing…")
  const tab = page.locator('[id$="-content-canvas"]')
  await expect(tab.getByRole("button", { name: "Use this one" })).toBeVisible()
})
