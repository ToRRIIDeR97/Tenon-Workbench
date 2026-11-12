// PR6 verification: open the Command Centre card with Ctrl+J on Home and measure it.
// Run from tenon/packages/app as e2e/.uiux-pr6.mts: node --experimental-strip-types e2e/.uiux-pr6.mts <outdir> <workspace>
import { chromium } from "@playwright/test"

const [OUT, WS] = [process.argv[2]!, process.argv[3]!]
const check = (id: string, pass: boolean, detail: unknown) => console.log(pass ? "PASS" : "FAIL", id, JSON.stringify(detail))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })
page.setDefaultTimeout(20_000)
await page.goto("http://localhost:4445")
await page.waitForTimeout(4000)
if (await page.getByRole("button", { name: "Open folder" }).first().isVisible().catch(() => false)) {
  await page.getByRole("button", { name: "Open folder" }).last().click()
  await page.keyboard.type(WS)
  await page.waitForTimeout(2500)
  await page.locator("[role=dialog]").getByText("ws", { exact: true }).first().click()
  await page.waitForTimeout(5000)
}
await page.locator("body").click({ position: { x: 700, y: 120 } })
await page.keyboard.press("Control+j")
await page.waitForTimeout(800)
const card = await page.evaluate(() => {
  const root = document.querySelector("[data-command-strip]")
  const surface = root?.querySelector("[data-command-strip-card] > div") as HTMLElement | null
  return {
    open: root?.getAttribute("data-state"),
    width: root?.getBoundingClientRect().width,
    radius: surface ? getComputedStyle(surface).borderTopLeftRadius : null,
    title: root?.querySelector('[data-slot="command-card-title"]')?.textContent ?? null,
    newThread: !!root?.querySelector('[data-action="command-card-new"]'),
    focused: !!root?.contains(document.activeElement),
  }
})
check("V1 card opens with Ctrl+J and takes focus", card.open === "open" && card.focused, card)
check("V2 card is 640px with 24px corners and a title", card.width === 640 && card.radius === "24px" && card.title === "Command Centre", card)
await page.screenshot({ path: `${OUT}/card.png`, clip: { x: 300, y: 560, width: 1140, height: 340 } })
await page.keyboard.press("Escape")
await page.waitForTimeout(500)
check("V3 Esc closes it", (await page.locator("[data-command-strip]").getAttribute("data-state")) === "closed", {})
await browser.close()
