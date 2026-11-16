import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { brain, openApp } from "./open-app"

// P3 · B Board canvas (implementations/live-agent-canvas/implementation.md, AC-24)

const directory = brain
const sessionID = "ses_live_board"
const userID = "msg_live_board_user"
const assistantID = "msg_live_board_assistant"
const partID = "prt_live_board_text"
const model = { providerID: "opencode", modelID: "claude-opus-4-6" }
const thread = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_live_board",
  directory,
  title: "Three pages",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

const intro = "Here are three pages.\n\n"
const fence = (title: string, body: string, closed: boolean) =>
  `\`\`\`html canvas title="${title}"\n<style>h1{font:600 48px system-ui}</style>\n${body}${closed ? "\n```\n" : ""}`
const done = (title: string) => fence(title, `<main><h1>${title}</h1><p>Finished</p></main>`, true)
// The reply as it grows: each design opens, grows once (so it counts as drawing here), then closes.
const steps = [
  intro + fence("Alpha", "<main><h1>Al", false),
  intro + fence("Alpha", "<main><h1>Alpha</h1><p>Fir", false),
  intro + done("Alpha"),
  intro + done("Alpha") + fence("Beta", "<main><h1>Be", false),
  intro + done("Alpha") + fence("Beta", "<main><h1>Beta</h1><p>Sec", false),
  intro + done("Alpha") + done("Beta"),
  intro + done("Alpha") + done("Beta") + fence("Gamma", "<main><h1>Ga", false),
  intro + done("Alpha") + done("Beta") + fence("Gamma", "<main><h1>Gamma</h1><p>Thi", false),
  intro + done("Alpha") + done("Beta") + fence("Gamma", "<main><h1>Gamma</h1><p>Third</p><p>More", false),
  intro + done("Alpha") + done("Beta") + done("Gamma"),
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
// The thread loads through the legacy message list, so the reply grows with legacy part updates.
const partEvent = (index: number) => ({
  directory,
  payload: {
    type: "message.part.updated",
    properties: { part: { ...textPart(steps[index]!), sessionID, messageID: assistantID } },
  },
})
// Alpha grows once more without a new design starting.
const alphaMore = {
  directory,
  payload: {
    type: "message.part.updated",
    properties: {
      part: {
        ...textPart(intro + fence("Alpha", "<main><h1>Alpha</h1><p>First</p><p>And mo", false)),
        sessionID,
        messageID: assistantID,
      },
    },
  },
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

async function start(page: Page) {
  const feed: unknown[] = []
  await openApp(page, {
    sessions: [thread],
    pageMessages: (id) =>
      id === sessionID
        ? {
            items: [
              message("user", userID, [{ id: "prt_live_board_user", type: "text", text: "Draw three pages" }]),
              message("assistant", assistantID, [textPart(intro)]),
            ],
          }
        : { items: [] },
    // A heartbeat on otherwise empty connections keeps the app's reconnect backoff at its base.
    events: () => (feed.length ? feed.splice(0, 1) : [heartbeat]),
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Here are three pages.")).toBeVisible()
  // The first design opens large (P2); going back to the list shows the board, which then follows.
  feed.push(partEvent(0), partEvent(1))
  const large = page.locator('[data-canvas-design="live"]')
  await expect(large).toBeVisible()
  await large.getByRole("button", { name: "All designs" }).click()
  const board = page.locator('[data-slot="design-board"]')
  await expect(board).toBeVisible()
  return { feed, board }
}

const centre = async (locator: Locator) => {
  const box = await locator.boundingBox()
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: NaN, y: NaN }
}
// The camera settles with the given board centred in the board's viewport.
const expectCentred = async (board: Locator, artboard: Locator) =>
  expect
    .poll(async () => {
      const a = await centre(artboard)
      const b = await centre(board)
      return Math.round(Math.hypot(a.x - b.x, a.y - b.y))
    })
    .toBeLessThanOrEqual(2)
// Every artboard lies inside the board's viewport.
const expectInside = async (board: Locator, artboards: Locator[]) =>
  expect
    .poll(async () => {
      const outer = await board.boundingBox()
      const boxes = await Promise.all(artboards.map((artboard) => artboard.boundingBox()))
      return boxes.every(
        (box) =>
          !!box &&
          !!outer &&
          box.x >= outer.x - 1 &&
          box.y >= outer.y - 1 &&
          box.x + box.width <= outer.x + outer.width + 1 &&
          box.y + box.height <= outer.y + outer.height + 1,
      )
    })
    .toBe(true)
const zoomText = (page: Page) => page.locator('[data-slot="board-zoom"]')
const percent = async (page: Page) => Number((await zoomText(page).textContent())?.replace("%", ""))

test("AC-24 the board follows each design as it draws, then shows them all", async ({ page }) => {
  const { feed, board } = await start(page)
  const alpha = page.getByRole("button", { name: "View Alpha" })
  const beta = page.getByRole("button", { name: "View Beta" })
  const gamma = page.getByRole("button", { name: "View Gamma" })
  await expect(board).toHaveAttribute("data-following", "")
  await expect(alpha).toHaveAttribute("data-board-drawing", "")
  await expectCentred(board, alpha)
  const followed = await percent(page)

  feed.push(partEvent(2), partEvent(3), partEvent(4))
  await expect(beta).toHaveAttribute("data-board-drawing", "")
  await expectCentred(board, beta)
  // Still the board, not the large view: someone looking at the board keeps it.
  await expect(page.locator('[data-canvas-design="live"]')).toHaveCount(0)

  feed.push(partEvent(5), partEvent(6), partEvent(7))
  await expect(gamma).toHaveAttribute("data-board-drawing", "")
  await expectCentred(board, gamma)
  await expect(page.locator('[data-slot="board-label"][data-board-key$=":2"]')).toContainText("C · Gamma")
  await expect(page.locator('[data-slot="board-label"][data-board-key$=":2"]')).toContainText("Drawing…")
  await shot(page, "1-following-gamma")

  // Nothing draws any more: the camera zooms out to show all three.
  feed.push(partEvent(8), partEvent(9))
  await expect(gamma).not.toHaveAttribute("data-board-drawing", "")
  await expect.poll(() => percent(page)).toBeLessThan(followed)
  await expectInside(board, [alpha, beta, gamma])
  await expect(page.locator('[data-slot="board-label"]')).toHaveCount(3)
  await expect(page.locator('[data-slot="board-label"]').filter({ hasText: "Use this one" })).toHaveCount(3)
  // The tall side panel stacks the boards, so they fit larger than a two-column grid would.
  const area = await board.boundingBox()
  const twoColumns = Math.min((area!.width - 64) / 2760, (area!.height - 64) / 1800)
  expect(await percent(page)).toBeGreaterThan(Math.round(twoColumns * 100))
  // Short titles are shown whole.
  const titles = page.locator('[data-slot="board-label-title"]')
  await expect(titles).toHaveText(["A · Alpha", "B · Beta", "C · Gamma"])
  expect(await titles.evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth))).toBe(true)
  await expect(zoomText(page)).toHaveAttribute("aria-label", `Fit all designs, ${await percent(page)}%`)
  await shot(page, "2-overview")

  // A label's Use this one references that design in the composer.
  await page
    .locator('[data-slot="board-label"][data-board-key$=":1"]')
    .getByRole("button", { name: "Use this one" })
    .click()
  await expect(page.locator('[data-component="prompt-input"]')).toContainText('Use design "Beta"')

  // Clicking a board opens it large.
  await beta.click()
  const opened = page.locator('[data-canvas-design="history"], [data-canvas-design="live"]')
  await expect(opened).toBeVisible()
  await expect(opened.getByText("Beta", { exact: true })).toBeVisible()
})

test("AC-24 wheel, buttons and drag move the camera and stop it following", async ({ page }) => {
  const { feed, board } = await start(page)
  const alpha = page.getByRole("button", { name: "View Alpha" })
  const world = page.locator('[data-slot="design-board-world"]')
  await expectCentred(board, alpha)
  const before = await percent(page)

  // Wheel zooms at the pointer and stops the following.
  const box = await board.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, -200)
  await expect(board).not.toHaveAttribute("data-following", "")
  await expect.poll(() => percent(page)).toBeGreaterThan(before)
  const zoomed = await world.getAttribute("style")

  // More drawing of the same design doesn't move the camera back.
  feed.push(alphaMore)
  await expect(page.frameLocator('[aria-label="View Alpha"] iframe').getByText("And mo")).toBeVisible()
  await expect(world).toHaveAttribute("style", zoomed!)

  // The pill's buttons zoom around the centre.
  const wheeled = await percent(page)
  await page.getByRole("button", { name: "Zoom out" }).click()
  await expect.poll(() => percent(page)).toBeLessThan(wheeled)
  const out = await percent(page)
  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect.poll(() => percent(page)).toBeGreaterThan(out)

  // A drag pans, and the release over a board doesn't open it.
  const panned = await world.getAttribute("style")
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 - 120, box!.y + box!.height / 2 - 60, { steps: 6 })
  await page.mouse.up()
  await expect(world).not.toHaveAttribute("style", panned!)
  await expect(page.locator("[data-canvas-design]")).toHaveCount(0)

  // Keyboard: 0 fits all, + zooms in.
  await board.focus()
  await page.keyboard.press("0")
  await expect(board).not.toHaveAttribute("data-camera-moving", "")
  const fitted = await percent(page)
  await page.keyboard.press("+")
  await expect.poll(() => percent(page)).toBeGreaterThan(fitted)
})

test("AC-24 the next design starting resumes the following", async ({ page }) => {
  const { feed, board } = await start(page)
  await expectCentred(board, page.getByRole("button", { name: "View Alpha" }))
  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(board).not.toHaveAttribute("data-following", "")

  feed.push(partEvent(2), partEvent(3), partEvent(4))
  const beta = page.getByRole("button", { name: "View Beta" })
  await expect(beta).toHaveAttribute("data-board-drawing", "")
  await expect(board).toHaveAttribute("data-following", "")
  await expectCentred(board, beta)
})
