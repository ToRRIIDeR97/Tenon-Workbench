import { expect, test } from "@playwright/test"
import { openApp } from "./open-app"

test("AC-2.4 no Dictate button without the desktop dictation API", async ({ page }) => {
  await openApp(page)
  await page.goto("/")
  await expect(page.getByRole("textbox").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Dictate" })).toHaveCount(0)
})
