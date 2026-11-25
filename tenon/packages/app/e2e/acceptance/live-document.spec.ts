import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { brain, openApp } from "./open-app"

const directory = brain
const sessionID = "ses_live_doc"
const userID = "msg_live_doc_user"
const assistantID = "msg_live_doc_assistant"
const model = { providerID: "opencode", modelID: "claude-opus-4-6" }
const thread = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_live_doc",
  directory,
  title: "Plan",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

const filler = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1} of the plan, kept as written.`)
const plan = ["# Plan", "## Goals", "Ship it.", ...filler, "## Anchor", "The reader is here."].join("\n\n")
const longer =
  "Ship it soon, in two steps: first the read path behind a flag for a week, then the write path once the error rate stays flat."
const edited = plan.replace("Ship it.", longer)

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

const intro = { id: "prt_live_doc_text", type: "text", text: "Writing the plan." }
const tool = (callID: string, name: string, status: string, input: Record<string, unknown>) => ({
  id: `prt_${callID}`,
  type: "tool",
  tool: name,
  callID,
  state:
    status === "completed"
      ? { status, input, output: "", title: name, metadata: {}, time: { start: 1, end: 2 } }
      : status === "running"
        ? { status, input, time: { start: 1 } }
        : { status, input, raw: JSON.stringify(input) },
})
const partEvent = (part: Record<string, unknown>) => ({
  directory,
  payload: { type: "message.part.updated", properties: { part: { ...part, sessionID, messageID: assistantID } } },
})
const heartbeat = { directory: "global", payload: { type: "server.heartbeat", properties: {} } }
const writing = (content: string, status = "pending") =>
  partEvent(tool("call_1_write", "write", status, { filePath: "docs/plan.md", content }))

const base64 = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
const shots = process.env.LIVE_CANVAS_SHOTS
const shot = async (page: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, `${name}.png`) })
}

test.use({ viewport: { width: 1440, height: 900 } })

async function start(page: Page, parts: Record<string, unknown>[] = [intro], completed?: number) {
  const feed: unknown[] = []
  const disk = { text: plan, reads: 0 }
  await openApp(page, {
    sessions: [thread],
    pageMessages: (id) =>
      id === sessionID
        ? {
            items: [
              message("user", userID, [{ id: "prt_live_doc_user", type: "text", text: "Write the plan" }]),
              message("assistant", assistantID, parts, completed),
            ],
          }
        : { items: [] },
    fileContent: (file) => {
      if (file.endsWith("plan.md")) disk.reads += 1
      return { type: "text", content: disk.text }
    },
    events: () => (feed.length ? feed.splice(0, 1) : [heartbeat]),
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Write the plan", { exact: true })).toBeVisible()
  return { feed, disk }
}

test("AC-18 … AC-19 a write types into the Files tab live, then an edit flashes its block", async ({ page }) => {
  const { feed, disk } = await start(page)
  const viewer = page.locator('[data-component="file-viewer"]')
  await expect(viewer).toHaveCount(0)

  feed.push(
    writing("# Plan\n\n## Goals"),
    writing("# Plan\n\n## Goals\n\nShip it.\n\n" + filler.slice(0, 3).join("\n\n")),
  )
  await expect(viewer).toBeVisible()
  const status = viewer.locator('[data-slot="live-document-status"]')
  await expect(status).toHaveText("Tenon is writing")
  await expect(viewer.getByRole("heading", { name: "Goals" })).toBeVisible()
  await expect(viewer.getByText("Paragraph 3 of the plan")).toBeVisible()
  await expect(viewer.locator('[data-slot="live-document-caret"]')).toBeVisible()
  const follow = page.locator('[data-slot="live-document-follow"]')
  await expect(follow).toHaveText("Following Tenon")
  await shot(page, "1-writing")

  await viewer.locator('[data-action="file-viewer-source"]').click()
  await expect(viewer.locator('[data-slot="live-document-source"]')).toContainText("## Goals")
  await viewer.locator('[data-action="file-viewer-rendered"]').click()

  await expect.poll(() => disk.reads).toBeGreaterThan(0)
  const reads = disk.reads
  feed.push(writing(plan, "completed"))
  await expect.poll(() => disk.reads).toBeGreaterThan(reads)
  await expect(status).toHaveText("Saved just now")
  await expect(viewer.getByText("The reader is here.")).toBeVisible()
  await expect(viewer.locator('[data-slot="live-document-caret"]')).toHaveCount(0)

  const anchor = viewer.getByText("The reader is here.")
  await anchor.scrollIntoViewIfNeeded()
  const before = (await anchor.boundingBox())!.y
  disk.text = edited
  feed.push(
    partEvent(
      tool("call_2_edit", "edit", "completed", {
        filePath: "docs/plan.md",
        oldString: "Ship it.",
        newString: longer,
      }),
    ),
  )
  const changed = viewer.getByText(longer)
  await expect(changed).toHaveAttribute("data-live-flash", "")
  await expect(viewer.locator("[data-live-flash]")).toHaveCount(1)
  await expect.poll(async () => Math.round((await anchor.boundingBox())!.y - before)).toBe(0)
  await changed.scrollIntoViewIfNeeded()
  await shot(page, "2-flash")
})

test("AC-18 closing the panel while the file streams doesn't reopen it", async ({ page }) => {
  const { feed } = await start(page)
  const viewer = page.locator('[data-component="file-viewer"]')
  feed.push(writing("# Plan"), writing("# Plan\n\n## Goals"))
  await expect(viewer).toBeVisible()
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(viewer).toHaveCount(0)
  feed.push(writing("# Plan\n\n## Goals\n\nShip it."), writing("# Plan\n\n## Goals\n\nShip it.\n\nMore."))
  feed.push(partEvent({ ...intro, text: "Writing the plan. All written." }))
  await expect(page.getByText("Writing the plan. All written.")).toBeVisible()
  await expect(viewer).toHaveCount(0)
})

test("AC-18 a write from history doesn't open the panel", async ({ page }) => {
  await start(
    page,
    [intro, tool("call_old", "write", "completed", { filePath: "docs/plan.md", content: plan })],
    1762000009000,
  )
  await expect(page.getByText("Writing the plan.")).toBeVisible()
  await expect(page.locator('[data-component="file-viewer"]')).toHaveCount(0)
})

test("AC-18 an html write stays a Canvas design", async ({ page }) => {
  const { feed } = await start(page)
  const html = (content: string) =>
    partEvent(tool("call_html", "write", "pending", { filePath: "designs/hero.html", content }))
  feed.push(html("<main><h1>He"), html("<main><h1>Hero</h1><p>Sub"))
  await expect(page.locator("[data-canvas-design]")).toBeVisible()
  await expect(page.locator('[data-component="file-viewer"]')).toHaveCount(0)
})
