import { expect, test } from "@playwright/test"
import { openApp } from "./open-app"

// P2 · Dictation, AC-2.4: the web build has no dictation platform API, so no mic button renders.
test("AC-2.4 no Dictate button without the desktop dictation API", async ({ page }) => {
  await openApp(page)
  await page.goto("/")
  await expect(page.getByRole("textbox").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Dictate" })).toHaveCount(0)
})
