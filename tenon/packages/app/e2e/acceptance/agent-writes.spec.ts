import { expect, test, type Page } from "@playwright/test"
import { brain, openApp } from "./open-app"

// P6 · Write previews (implementations/notes-command-centre/implementation.md, AC-6.1, AC-6.3 … AC-6.6)

const directory = `${brain}/projects/Acme`
const sessionID = "ses_acme_thread"
const thread = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_acme",
  directory,
  title: "Cookie migration",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

type Event = { directory: string; payload: Record<string, unknown> }

const write = (
  phase: "started" | "done",
  kind: string,
  preview: unknown,
  id = `w_${kind}`,
  session = sessionID,
): Event => ({
  directory,
  payload: {
    id: `evt_${id}_${phase}`,
    type: "agent.write",
    properties: {
      id,
      sessionID: session,
      kind,
      phase,
      target: "Acme API",
      preview,
      ...(phase === "done" ? { undo: `undo_${id}` } : {}),
    },
  },
})

const previews: Record<string, { preview: unknown; expect: string[] }> = {
  note: {
    preview: { title: "Week 45 progress", text: "Done: rate limiting." },
    expect: ["Week 45 progress", "Done: rate limiting."],
  },
  tasks: {
    preview: { tasks: [{ title: "Webhook retries", dueDate: "2026-11-09" }, { title: "Rotate signing secret" }] },
    expect: ["Webhook retries", "Rotate signing secret"],
  },
  calendar: {
    preview: { events: [{ title: "Billing review", date: "2026-11-02", start: "14:00", end: "15:00" }] },
    expect: ["Billing review"],
  },
  timeline: {
    preview: {
      projectId: "project_01ACME",
      items: [
        { id: "auth", title: "Auth redesign", kind: "task", status: "done", start: "2026-11-02", end: "2026-11-12" },
      ],
    },
    expect: ["Auth redesign"],
  },
  email: {
    preview: { to: "billing-team@acme.dev", subject: "Webhook retries from Monday", body: "Hi team" },
    expect: ["billing-team@acme.dev", "Webhook retries from Monday", "Saved as a draft. Tenon never sends email."],
  },
}

async function start(page: Page, events: Event[], undoStatus = 200) {
  const undos: string[] = []
  await openApp(page, { sessions: [thread], events: () => events.splice(0, 1), eventRetry: 16 })
  await page.route("**/second-brain/writes/*/undo", async (route) => {
    undos.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: undoStatus, contentType: "application/json", body: "{}" })
  })
  return undos
}
const base64 = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

test.use({ viewport: { width: 1360, height: 860 } })

test("AC-6.1 a write by the open thread shows inline and folds to Open and Undo", async ({ page }) => {
  const events = [write("started", "note", previews.note.preview), write("done", "note", previews.note.preview)]
  await start(page, events)
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  const card = page.locator('[data-agent-write][data-variant="inline"][data-kind="note"]')
  await expect(card).toBeVisible()
  await expect(card.getByRole("button", { name: "Open" })).toBeVisible()
  await expect(card.getByRole("button", { name: "Undo" })).toBeVisible()
  // The card sits in the thread's centred column, over the composer, not at the page's left edge.
  const centre = (box: { x: number; width: number } | null) => (box ? box.x + box.width / 2 : NaN)
  const composer = await page.locator('[data-component="prompt-input"]').boundingBox()
  expect(Math.abs(centre(await card.boundingBox()) - centre(composer))).toBeLessThan(24)
})

test("AC-6.3 a write elsewhere shows the pill, which ends on Saved", async ({ page }) => {
  const events = [write("started", "tasks", previews.tasks.preview), write("done", "tasks", previews.tasks.preview)]
  await start(page, events)
  await page.goto("/calendar")
  const pill = page.locator('[data-agent-write][data-variant="pill"]')
  await expect(pill).toBeVisible()
  await expect(pill).toContainText("Saved")
  await expect(pill.getByRole("button", { name: "Undo" })).toBeVisible()
})

for (const [kind, sample] of Object.entries(previews)) {
  test(`AC-6.4 the ${kind} preview shows its content`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await start(page, [write("started", kind, sample.preview), write("done", kind, sample.preview)])
    await page.goto(`/${base64(directory)}/session/${sessionID}`)
    const card = page.locator(`[data-agent-write][data-kind="${kind}"]`).first()
    await expect(card).toBeVisible()
    // The folded card hides the preview; Show expands it again.
    const show = card.getByRole("button", { name: "Show" })
    if (await show.count()) await show.first().click()
    for (const text of sample.expect) await expect(card).toContainText(text)
  })
}

test("AC-6.5 Undo calls the endpoint and confirms", async ({ page }) => {
  const undos = await start(page, [
    write("started", "note", previews.note.preview),
    write("done", "note", previews.note.preview),
  ])
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  const card = page.locator('[data-agent-write][data-variant="inline"]')
  await card.getByRole("button", { name: "Undo" }).click()
  await expect(card).toContainText("Undone")
  expect(undos).toEqual(["/second-brain/writes/undo_w_note/undo"])
})

test("AC-6.5 an undo refused with 409 says it already changed", async ({ page }) => {
  await start(
    page,
    [write("started", "note", previews.note.preview), write("done", "note", previews.note.preview)],
    409,
  )
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  const card = page.locator('[data-agent-write][data-variant="inline"]')
  await card.getByRole("button", { name: "Undo" }).click()
  await expect(card).toContainText("Already changed")
})

test("AC-6.6 reduced motion shows the final note text at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await start(page, [write("started", "note", previews.note.preview)])
  await page.goto(`/${base64(directory)}/session/${sessionID}`)
  const card = page.locator('[data-agent-write][data-kind="note"]')
  await expect(card).toContainText("Done: rate limiting.", { timeout: 1500 })
})
