import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { brain, openApp } from "./open-app"

// P5 · D Tracked edits (implementations/live-agent-canvas/implementation.md, AC-25)

const directory = brain
const sessionID = "ses_tracked"
const userID = "msg_tracked_user"
const assistantID = "msg_tracked_assistant"
const model = { providerID: "opencode", modelID: "claude-opus-4-6" }
const thread = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_tracked",
  directory,
  title: "Plan",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

const plan = ["# Plan", "", "Ship it.", "", "Keep the cap.", "", "Done."].join("\n")
const longer = "Ship it soon, in two steps: read path first, then writes."
const edited = plan.replace("Ship it.", longer)
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

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

const intro = { id: "prt_tracked_text", type: "text", text: "Editing the plan." }
const edit = (status: string, newString: string) => {
  const input = { filePath: "docs/plan.md", oldString: "Ship it.", newString }
  return {
    directory,
    payload: {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_call_edit",
          type: "tool",
          tool: "edit",
          callID: "call_edit",
          sessionID,
          messageID: assistantID,
          state:
            status === "completed"
              ? { status, input, output: "", title: "edit", metadata: {}, time: { start: 1, end: 2 } }
              : { status, input, raw: JSON.stringify(input) },
        },
      },
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

type Write = { path: string; content: string; expectedHash: string }

async function start(page: Page, answer: (body: Write, index: number) => { status: number; body: unknown }) {
  const feed: unknown[] = []
  // The mock serves the text as it is when a read arrives; `reads` counts the plan's reads.
  const disk = { text: plan, reads: 0 }
  const writes: Write[] = []
  await openApp(page, {
    sessions: [thread],
    pageMessages: (id) =>
      id === sessionID
        ? {
            items: [
              message("user", userID, [{ id: "prt_tracked_user", type: "text", text: "Tighten the plan" }]),
              message("assistant", assistantID, [intro]),
            ],
          }
        : { items: [] },
    fileContent: (file) => {
      if (file.endsWith("plan.md")) disk.reads += 1
      return { type: "text", content: disk.text }
    },
    fileWrite: ({ body }) => {
      const write = body as Write
      writes.push(write)
      const result = answer(write, writes.length - 1)
      if (result.status === 200) disk.text = write.content
      return result
    },
    events: () => (feed.length ? feed.splice(0, 1) : [heartbeat]),
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Tighten the plan", { exact: true })).toBeVisible()
  const viewer = page.locator('[data-component="file-viewer"]')
  const tracked = viewer.locator('[data-slot="tracked-source"]')

  // The edit streams: the panel opens on the file; Source shows the change live.
  feed.push(edit("pending", "Ship it soon"), edit("pending", "Ship it soon, in two"))
  await expect(viewer).toBeVisible()
  await expect.poll(() => disk.reads).toBeGreaterThan(0)
  await viewer.locator('[data-action="file-viewer-source"]').click()
  await expect(viewer.locator('[data-action="file-viewer-source"]')).toHaveAttribute("aria-pressed", "true")
  await expect(tracked.locator('[data-row="removed"]')).toHaveText(/Ship it\./)
  await expect(tracked.locator('[data-row="added"]')).toContainText("Ship it soon, in two")
  await expect(tracked.locator('[data-slot="tracked-review"]')).toHaveCount(0)

  // The edit finishes: the file reloads and the change gets Keep and Undo.
  const reads = disk.reads
  disk.text = edited
  feed.push(edit("completed", longer))
  await expect.poll(() => disk.reads).toBeGreaterThan(reads)
  await expect(tracked.locator('[data-row="added"]')).toContainText(longer)
  await expect(tracked.locator('[data-slot="tracked-header"]')).toContainText("1 edit by Tenon")
  await expect(tracked.locator('[data-slot="tracked-review"]')).toHaveCount(1)
  return { viewer, tracked, disk, writes }
}

test("AC-25 a streamed edit shows live, then Undo writes the original back", async ({ page }) => {
  const { viewer, tracked, writes } = await start(page, (body) => ({ status: 200, body: { hash: sha(body.content) } }))
  await shot(page, "2-review-bar")
  await tracked.locator('[data-action="tracked-undo"]').click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toEqual({ path: "docs/plan.md", content: plan, expectedHash: sha(edited) })
  await expect(tracked).toHaveCount(0)
  await expect(viewer.getByText("Ship it.", { exact: true })).toBeVisible()
  await expect(viewer.getByText(longer)).toHaveCount(0)
})

test("AC-25 a conflict shows the banner and Override retries with the current hash", async ({ page }) => {
  const { tracked, writes } = await start(page, (body, index) =>
    index === 0
      ? { status: 409, body: { name: "FileConflictError", currentHash: sha("someone else's text") } }
      : { status: 200, body: { hash: sha(body.content) } },
  )
  await tracked.locator('[data-action="tracked-undo"]').click()
  const banner = tracked.locator('[data-slot="tracked-conflict"]')
  await expect(banner).toContainText("This file changed since Tenon's edit")
  await expect(banner.locator('[data-action="tracked-reload"]')).toBeVisible()
  await shot(page, "3-conflict")
  await banner.locator('[data-action="tracked-override"]').click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toEqual({ path: "docs/plan.md", content: plan, expectedHash: sha("someone else's text") })
  await expect(tracked).toHaveCount(0)
})

test("AC-25 Keep clears the highlight and writes nothing", async ({ page }) => {
  const { viewer, tracked, writes } = await start(page, () => ({ status: 500, body: {} }))
  await tracked.locator('[data-action="tracked-keep"]').click()
  await expect(tracked).toHaveCount(0)
  await expect(viewer.getByText(longer)).toBeVisible()
  expect(writes).toHaveLength(0)
})

test("AC-25 the live edit, for the screenshot", async ({ page }) => {
  test.skip(!shots, "screenshots only")
  const feed: unknown[] = []
  await openApp(page, {
    sessions: [thread],
    pageMessages: (id) =>
      id === sessionID
        ? {
            items: [
              message("user", userID, [{ id: "prt_tracked_user", type: "text", text: "Tighten the plan" }]),
              message("assistant", assistantID, [intro]),
            ],
          }
        : { items: [] },
    fileContent: () => ({ type: "text", content: plan }),
    events: () => (feed.length ? feed.splice(0, 1) : [heartbeat]),
    eventRetry: 40,
  })
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  await expect(page.getByText("Tighten the plan", { exact: true })).toBeVisible()
  const viewer = page.locator('[data-component="file-viewer"]')
  feed.push(edit("pending", "Ship it soon"), edit("pending", "Ship it soon, in two steps"))
  await expect(viewer).toBeVisible()
  await viewer.locator('[data-action="file-viewer-source"]').click()
  await expect(viewer.locator('[data-row="added"]')).toContainText("in two steps")
  // The segmented control says which view shows.
  await expect(viewer.locator('[data-action="file-viewer-source"]')).toHaveAttribute("aria-pressed", "true")
  await expect(viewer.locator('[data-action="file-viewer-rendered"]')).toHaveAttribute("aria-pressed", "false")
  await page.mouse.move(0, 0)
  await shot(page, "1-live-edit")
})
