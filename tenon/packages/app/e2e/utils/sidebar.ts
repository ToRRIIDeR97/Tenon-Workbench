import { expect, type Page } from "@playwright/test"

export async function openFolderFromWorkspaceMenu(page: Page) {
  const menu = page.getByRole("button", { name: "Switch workspace" })
  await expect(menu).toBeVisible()
  await menu.click()
  await page.getByRole("menuitem", { name: "Open folder as workspace" }).click()
}

export async function expandSidebarThreadGroups(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tenon.window.browser.dat:sidebar", JSON.stringify({ expanded: { __brain__: true } }))
  })
}

export async function openSidebarThread(page: Page, sessionID: string) {
  const row = page.locator(`[data-sidebar-thread="${sessionID}"] [data-sidebar-thread-open]`)
  await expect(row).toBeVisible()
  await row.click()
}

export async function openSidebarThreadByTitle(page: Page, title: string) {
  const row = page.locator("[data-sidebar-thread-open]", { hasText: title })
  await expect(row).toBeVisible()
  await row.click()
}
