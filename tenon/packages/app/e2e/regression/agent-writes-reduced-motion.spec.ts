import { expect, test } from "@playwright/test"
import { brain, openApp } from "../acceptance/open-app"

// AC-6.6: under reduced motion a write in progress shows its whole text on the first render; with
// motion, the same text types in over about a second, so a check right after the card appears tells
// the two apart.

const directory = `${brain}/projects/Acme`
const sessionID = "ses_acme_thread"
const text = "Shipped rate limiting and the webhook retry queue. ".repeat(12).trim()
const thread = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_acme",
  directory,
  title: "Cookie migration",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}
const started = {
  directory,
  payload: {
    id: "evt_typing",
    type: "agent.write",
    properties: {
      id: "w_typing",
      sessionID,
      kind: "note",
      phase: "started",
      target: "Acme API",
      preview: { title: "Week 45", text },
    },
  },
}
const base64 = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

test.use({ viewport: { width: 1360, height: 860 } })

for (const reduced of [true, false]) {
  test(`a note in progress ${reduced ? "shows its full text at once" : "types in"} ${reduced ? "with" : "without"} reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" })
    const events = [started]
    await openApp(page, { sessions: [thread], events: () => events.splice(0, 1), eventRetry: 16 })
    await page.goto(`/${base64(directory)}/session/${sessionID}`)
    const paragraph = page.locator('[data-agent-write][data-kind="note"] p')
    await expect(paragraph).toBeAttached()
    const first = await paragraph.textContent()
    if (reduced) expect(first).toBe(text)
    else expect(first?.length ?? 0).toBeLessThan(text.length)
  })
}
