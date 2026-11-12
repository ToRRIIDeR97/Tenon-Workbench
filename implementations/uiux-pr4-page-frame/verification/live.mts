// UI/UX PR4 verification: page title vs content left edges, and the Settings header's right edge.
// Run from tenon/packages/app as e2e/.uiux-pr4.mts: node --experimental-strip-types e2e/.uiux-pr4.mts <outdir> <workspace>
import { chromium } from "@playwright/test"

const [OUT, WS] = [process.argv[2]!, process.argv[3]!]
const BASE = "http://localhost:4445"
const check = (id: string, pass: boolean, detail: unknown) => console.log(pass ? "PASS" : "FAIL", id, JSON.stringify(detail))
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

// V1: All projects: the h1 starts where the search field (first content) starts.
await page.evaluate(() => history.pushState({}, "", "/projects/overview"))
await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")))
await page.waitForTimeout(3000)
const overview = await page.evaluate(() => {
  const title = document.querySelector("#project-overview-title")?.getBoundingClientRect()
  const search = document.querySelector('input[aria-label]')?.closest("label")?.getBoundingClientRect()
  return { title: title?.left, content: search?.left }
})
// The back button sits before the title; compare the header's own left edge instead when present.
const header = await page.evaluate(() => document.querySelector("#project-overview-title")?.closest("header")?.getBoundingClientRect().left)
check("V1 All projects header shares the content column", header !== undefined && overview.content !== undefined && Math.abs(header + 24 - overview.content) <= 1 || Math.abs((header ?? 0) + 40 - (overview.content ?? 0)) <= 1, { header, ...overview })
await page.screenshot({ path: `${OUT}/v1-overview.png` })

// V2: Settings: header actions end on the cards' right edge.
await page.locator('button[aria-label="Settings"]').first().click()
await page.waitForSelector("[role=tab]", { timeout: 30_000 })
const servers = page.getByRole("tab", { name: "Servers", exact: true })
await servers.dispatchEvent("pointerdown", { button: 0, pointerType: "mouse" })
await servers.click().catch(() => {})
await page.waitForTimeout(2000)
const edges = await page.evaluate(() => {
  const header = document.querySelector(".settings-v2-tab-header")
  const body = document.querySelector(".settings-v2-tab-body")
  const headerRight = header ? header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight) : undefined
  const bodyRight = body ? body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight) : undefined
  return { headerRight, bodyRight }
})
check("V2 Settings header and body share a right edge", edges.headerRight !== undefined && edges.headerRight === edges.bodyRight, edges)
await page.screenshot({ path: `${OUT}/v2-settings.png` })
await browser.close()
