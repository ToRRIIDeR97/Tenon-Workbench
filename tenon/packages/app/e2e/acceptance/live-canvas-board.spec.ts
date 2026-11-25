import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { brain, openApp } from "./open-app"

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

const message = (role: "user" | "assistant", id: string, parts: Record<string, unknown>[], completed?: number) => ({
  info: {
    id,
    sessionID,
    role,
    time: { created: role === "user" ? 1762000000000 : 1762000001000, ...(completed ? { completed } : {}) },
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
    events: () => (feed.length ? feed.splice(0, 1) : [heartbeat]),
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Here are three pages.")).toBeVisible()
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
const expectCentred = async (board: Locator, artboard: Locator) =>
  expect
    .poll(async () => {
      const a = await centre(artboard)
      const b = await centre(board)
      return Math.round(Math.hypot(a.x - b.x, a.y - b.y))
    })
    .toBeLessThanOrEqual(2)
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
  await expect(page.locator('[data-canvas-design="live"]')).toHaveCount(0)

  feed.push(partEvent(5), partEvent(6), partEvent(7))
  await expect(gamma).toHaveAttribute("data-board-drawing", "")
  await expectCentred(board, gamma)
  await expect(page.locator('[data-slot="board-label"][data-board-key$=":2"]')).toContainText("C · Gamma")
  await expect(page.locator('[data-slot="board-label"][data-board-key$=":2"]')).toContainText("Drawing…")
  await shot(page, "1-following-gamma")

  feed.push(partEvent(8), partEvent(9))
  await expect(gamma).not.toHaveAttribute("data-board-drawing", "")
  await expect.poll(() => percent(page)).toBeLessThan(followed)
  await expectInside(board, [alpha, beta, gamma])
  await expect(page.locator('[data-slot="board-label"]')).toHaveCount(3)
  await expect(page.locator('[data-slot="board-label"]').filter({ hasText: "Use this one" })).toHaveCount(3)
  const area = await board.boundingBox()
  const twoColumns = Math.min((area!.width - 64) / 2760, (area!.height - 64) / 1800)
  expect(await percent(page)).toBeGreaterThan(Math.round(twoColumns * 100))
  const titles = page.locator('[data-slot="board-label-title"]')
  await expect(titles).toHaveText(["A · Alpha", "B · Beta", "C · Gamma"])
  expect(await titles.evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth))).toBe(true)
  await expect(zoomText(page)).toHaveAttribute("aria-label", `Fit all designs, ${await percent(page)}%`)
  await shot(page, "2-overview")

  await page
    .locator('[data-slot="board-label"][data-board-key$=":1"]')
    .getByRole("button", { name: "Use this one" })
    .click()
  await expect(page.locator('[data-component="prompt-input"]')).toContainText('Use design "Beta"')

  await page.setViewportSize({ width: 1440, height: 420 })
  await expect.poll(() => percent(page)).toBeLessThanOrEqual(12)
  await expect(board).not.toHaveAttribute("data-camera-moving", "")
  await expect(titles).toHaveText(["A · Alpha", "B · Beta", "C · Gamma"])
  expect(await titles.evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth))).toBe(true)
  for (const use of await page.locator('[data-slot="board-label-use"]').all()) await expect(use).toBeHidden()
  await shot(page, "3-short-window")
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-slot="board-label-use"]').first()).toBeVisible()

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

  const box = await board.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, -200)
  await expect(board).not.toHaveAttribute("data-following", "")
  await expect.poll(() => percent(page)).toBeGreaterThan(before)
  const zoomed = await world.getAttribute("style")

  feed.push(alphaMore)
  await expect(page.frameLocator('[aria-label="View Alpha"] iframe').getByText("And mo")).toBeVisible()
  await expect(world).toHaveAttribute("style", zoomed!)

  const wheeled = await percent(page)
  await page.getByRole("button", { name: "Zoom out" }).click()
  await expect.poll(() => percent(page)).toBeLessThan(wheeled)
  const out = await percent(page)
  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect.poll(() => percent(page)).toBeGreaterThan(out)

  const panned = await world.getAttribute("style")
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 - 120, box!.y + box!.height / 2 - 60, { steps: 6 })
  await page.mouse.up()
  await expect(world).not.toHaveAttribute("style", panned!)
  await expect(page.locator("[data-canvas-design]")).toHaveCount(0)

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

test("AC-24 a board opened from history keeps every title whole", async ({ page }) => {
  const titles = ["One", "Two", "Three", "Four", "Five", "Six"]
  await openApp(page, {
    sessions: [thread],
    pageMessages: (id) =>
      id === sessionID
        ? {
            items: [
              message("user", userID, [{ id: "prt_live_board_user", type: "text", text: "Draw six pages" }]),
              message("assistant", assistantID, [textPart(intro + titles.map(done).join(""))], 1762000009000),
            ],
          }
        : { items: [] },
    events: () => [heartbeat],
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Here are three pages.")).toBeVisible()
  await page.getByRole("button", { name: "Open in Canvas" }).first().click()
  const large = page.locator("[data-canvas-design]")
  await expect(large).toBeVisible()
  await large.getByRole("button", { name: "All designs" }).click()
  const board = page.locator('[data-slot="design-board"]')
  await expect(board).toBeVisible()
  await expect(board).not.toHaveAttribute("data-camera-moving", "")

  const labels = page.locator('[data-slot="board-label-title"]')
  await expect(labels).toHaveText(titles.map((title, index) => `${String.fromCharCode(65 + index)} · ${title}`))
  await expect
    .poll(() =>
      page.locator('[data-slot="board-label"]').evaluateAll((rows) =>
        rows.every((row) => {
          const title = row.querySelector<HTMLElement>('[data-slot="board-label-title"]')
          return !!title && title.scrollWidth <= title.clientWidth && row.scrollWidth <= row.clientWidth + 1
        }),
      ),
    )
    .toBe(true)
  const rows = await page.locator('[data-slot="board-label"]').evaluateAll((items) =>
    items.map((row) => {
      const title = row.querySelector<HTMLElement>('[data-slot="board-label-title"]')!
      const use = row.querySelector<HTMLElement>('[data-slot="board-label-use"]')!
      return {
        shown: getComputedStyle(use).visibility === "visible",
        fits: title.scrollWidth + 8 + use.offsetWidth <= row.clientWidth,
      }
    }),
  )
  expect(rows.map((row) => row.shown)).toEqual(rows.map((row) => row.fits))
  expect(rows.some((row) => row.shown)).toBe(true)
  await shot(page, "4-history-six")
})

test("AC-24 a design that arrives already finished leaves the board in view", async ({ page }) => {
  const { feed, board } = await start(page)
  await expectCentred(board, page.getByRole("button", { name: "View Alpha" }))
  feed.push(partEvent(2), {
    ...partEvent(5),
  })
  await expect(page.getByRole("button", { name: "View Beta" })).toBeVisible()
  await expect(page.getByRole("button", { name: "View Beta" })).not.toHaveAttribute("data-board-drawing", "")
  await expect(page.locator("[data-canvas-design]")).toHaveCount(0)
  await expect(board).toBeVisible()
})
