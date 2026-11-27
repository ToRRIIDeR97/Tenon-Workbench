import { expect, test } from "@playwright/test"
import { openApp } from "../acceptance/open-app"

test.use({ viewport: { width: 1360, height: 860 } })

test("Home stays in the page while its thread list loads, so the composer keeps focus", async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send("Emulation.setCPUThrottlingRate", { rate: 8 })
  await openApp(page)
  await page.addInitScript(() => {
    const removals: number[] = []
    Object.assign(window, { pageRemovals: removals })
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes)
          if (node instanceof HTMLElement && node.getAttribute("data-component") === "view-switch-v2")
            removals.push(performance.now())
    }).observe(document, { subtree: true, childList: true })
  })
  await page.goto("/")
  const editor = page.locator('main [data-component="prompt-input-v2"] [contenteditable="true"]').first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.waitForLoadState("networkidle")
  await expect(editor).toBeFocused()
  expect(await page.evaluate(() => (window as unknown as { pageRemovals: number[] }).pageRemovals)).toEqual([])
})
