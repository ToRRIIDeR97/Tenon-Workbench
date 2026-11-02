import { expect, test } from "@playwright/test"
import { openApp } from "../acceptance/open-app"

test("a vault inside a workspace folder is named instead of a generic failure", async ({ page }) => {
  await openApp(page)
  await page.route("**/second-brain/vault/**", (route) =>
    route.fulfill({ status: 400, json: { data: { message: "vault_inside_workspace" } } }),
  )
  await page.goto("/notes")
  const alert = page.getByRole("alert")
  await expect(alert).toContainText("The Tenon vault can't be inside a workspace or Project folder")
  await expect(alert).toContainText("Choose another folder in Settings.")
})
