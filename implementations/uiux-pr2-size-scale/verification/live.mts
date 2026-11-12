// UI/UX PR2 verification: measures rendered control sizes in the running dev app (http://localhost:4445).
// Run from tenon/packages/app as e2e/.uiux-pr2.mts: node --experimental-strip-types e2e/.uiux-pr2.mts <outdir> <workspace>
import { chromium } from "@playwright/test"

const [OUT, WS] = [process.argv[2]!, process.argv[3]!]
const BASE = "http://localhost:4445"
const check = (id: string, pass: boolean, detail: unknown) => console.log(pass ? "PASS" : "FAIL", id, JSON.stringify(detail))
const press = async (locator: ReturnType<import("@playwright/test").Page["locator"]>) => {
  await locator.dispatchEvent("pointerdown", { button: 0, pointerType: "mouse" })
  await locator.dispatchEvent("pointerup", { button: 0, pointerType: "mouse" })
  await locator.click().catch(() => {})
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })
page.setDefaultTimeout(20_000)
await page.goto(BASE)
await page.waitForTimeout(4000)
if (await page.getByRole("button", { name: "Open folder" }).first().isVisible().catch(() => false)) {
  await page.getByRole("button", { name: "Open folder" }).last().click()
  await page.keyboard.type(WS)
  await page.waitForTimeout(2500)
  await page.locator("[role=dialog]").getByText("ws", { exact: true }).first().click()
  await page.waitForTimeout(5000)
}

// V1: tokens resolve.
const tokens = await page.evaluate(() =>
  ["--v2-control-sm", "--v2-control-md", "--v2-control-lg"].map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()),
)
check("V1 control tokens 28/36/44", tokens.join(",") === "28px,36px,44px", tokens)

// V3: thread composer row.
await press(page.locator('button[aria-label="Start in a project"]').first())
await page.waitForTimeout(400)
const alpha = page.getByRole("menuitem", { name: "Alpha" })
await alpha.dispatchEvent("pointermove", { pointerType: "mouse" })
await alpha.dispatchEvent("pointerdown", { button: 0, pointerType: "mouse" })
await alpha.dispatchEvent("pointerup", { button: 0, pointerType: "mouse" })
await page.waitForTimeout(3000)
const row = await page.evaluate(() => {
  const h = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.getBoundingClientRect().height
  return {
    attach: h('[data-action="prompt-attach"]'),
    send: h('[data-action="prompt-submit"]'),
    mode: h("[data-action=permission-mode]"),
  }
})
check("V3 composer row 32px", row.attach === 32 && row.send === 32 && row.mode === 32, row)
await page.screenshot({ path: `${OUT}/v3-composer-row.png`, clip: { x: 300, y: 380, width: 1140, height: 260 } })

// V4: Skills search.
await page.locator('button[aria-label="Settings"]').first().click()
await page.waitForSelector("[role=tab]", { timeout: 30_000 })
const skills = page.getByRole("tab", { name: "Skills", exact: true })
await press(skills)
await page.waitForTimeout(2500)
const search = await page.evaluate(() => (document.querySelector('input[type="search"]')?.closest('[data-component="text-input-v2"]') as HTMLElement | null)?.getBoundingClientRect().height)
check("V4 Skills search 36px", search === 36, { search })
await page.screenshot({ path: `${OUT}/v4-skills.png` })
await browser.close()
