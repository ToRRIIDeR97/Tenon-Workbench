import { expect, test } from "@playwright/test"
import { openApp } from "./open-app"

// P9 · Routines, AC-9.5 (implementations/notes-command-centre/implementation.md)

const routines = [
  {
    id: "r_brief",
    name: "Morning brief",
    path: "Routines/Morning brief.md",
    schedule: "weekdays 08:30",
    enabled: true,
    nextRun: "2026-11-03T08:30:00.000Z",
    lastRun: "2026-11-02T08:30:00.000Z",
    lastStatus: "done",
  },
  {
    id: "r_review",
    name: "Weekly review",
    path: "Routines/Weekly review.md",
    schedule: "weekly fri 16:00",
    enabled: false,
    nextRun: "2026-11-06T16:00:00.000Z",
    lastRun: null,
    lastStatus: null,
  },
]

test.use({ viewport: { width: 1360, height: 860 } })

test("AC-9.5 the Routines page lists routines and Run now starts one", async ({ page }) => {
  const runs: string[] = []
  await openApp(page)
  await page.route("**/second-brain/routines**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === "POST") {
      runs.push(url.pathname)
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ threadId: "ses_run" }) })
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(routines) })
  })
  await page.goto("/command")
  await page.getByRole("link", { name: "Routines" }).click()
  await expect(page).toHaveURL(/\/routines$/)
  const row = page.getByRole("row").filter({ hasText: "Morning brief" })
  await expect(row).toContainText("weekdays 08:30")
  await expect(page.getByRole("row").filter({ hasText: "Weekly review" })).toBeVisible()
  await row.getByRole("button", { name: "Run now" }).click()
  await expect.poll(() => runs).toEqual(["/second-brain/routines/r_brief/run"])
})
