// UI/UX PR1 verification: measures computed styles in the running dev app (http://localhost:4445).
// Run from tenon/packages/app as e2e/.uiux-pr1.mts: node --experimental-strip-types e2e/.uiux-pr1.mts <outdir> <workspace>
import { chromium, type Page } from "@playwright/test"

const OUT = process.argv[2]!
const WS = process.argv[3]!
const BASE = "http://localhost:4445"
const results: Record<string, unknown> = {}
const check = (id: string, pass: boolean, detail: unknown) => {
  results[id] = { pass, detail }
  console.log(pass ? "PASS" : "FAIL", id, JSON.stringify(detail))
}

const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05)
}
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("span")
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)

const open = async (scheme: "light" | "dark") => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
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
  return { browser, page }
}

// V1/V2: theme tokens as the browser resolves them.
for (const scheme of ["light", "dark"] as const) {
  const { browser, page } = await open(scheme)
  const warn = await tokenColor(page, "--v2-state-fg-warning")
  const warnBg = await tokenColor(page, "--v2-state-bg-warning")
  check(`V1-${scheme} warning text on warning fill >= 4.5`, contrast(warn, warnBg) >= 4.5, {
    warn,
    warnBg,
    ratio: contrast(warn, warnBg).toFixed(2),
  })
  if (scheme === "dark") {
    const faint = await tokenColor(page, "--v2-text-text-faint")
    const muted = await tokenColor(page, "--v2-text-text-muted")
    const base = await tokenColor(page, "--v2-background-bg-base")
    const layer2 = await tokenColor(page, "--v2-background-bg-layer-02")
    check("V2 dark faint >= 4.5 on layer 2 and a step below muted", contrast(faint, layer2) >= 4.5 && contrast(muted, base) / contrast(faint, base) >= 1.15, {
      faint,
      muted,
      onLayer2: contrast(faint, layer2).toFixed(2),
      mutedOverFaint: (contrast(muted, base) / contrast(faint, base)).toFixed(2),
    })
  }

  if (scheme === "dark") {
    // V3: keyboard focus on the thread composer's send button draws an outline (Home's composer is a
    // different component whose IconButtonV2 already has the ring).
    const start = page.locator('button[aria-label="Start in a project"]').first()
    await start.dispatchEvent("pointerdown", { button: 0, pointerType: "mouse" })
    await start.dispatchEvent("pointerup", { button: 0, pointerType: "mouse" })
    await start.click().catch(() => {})
    await page.waitForTimeout(400)
    const alpha = page.getByRole("menuitem", { name: "Alpha" })
    await alpha.dispatchEvent("pointermove", { pointerType: "mouse" })
    await alpha.dispatchEvent("pointerdown", { button: 0, pointerType: "mouse" })
    await alpha.dispatchEvent("pointerup", { button: 0, pointerType: "mouse" })
    await page.waitForTimeout(3000)
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.click()
    await page.keyboard.type("hello")
    let found = false
    for (let i = 0; i < 12 && !found; i++) {
      await page.keyboard.press("Tab")
      found = await page.evaluate(() => document.activeElement?.getAttribute("data-action") === "prompt-submit")
    }
    const ring = found
      ? await page.evaluate(() => {
          const style = getComputedStyle(document.activeElement!)
          return { style: style.outlineStyle, width: style.outlineWidth }
        })
      : undefined
    check("V3 send button focus ring", !!ring && ring.style !== "none" && ring.width === "2px", { found, ring })
    await page.screenshot({ path: `${OUT}/v3-send-focus-${scheme}.png`, clip: { x: 300, y: 450, width: 1140, height: 450 } })

    // V5: project card actions in the sidebar.
    const action = page.locator('button[aria-label="New thread"][data-component="icon-button-v2"]').first()
    const exists = (await action.count()) > 0
    if (exists) {
      await action.focus()
      await page.keyboard.press("Shift+Tab")
      await page.keyboard.press("Tab")
      const box = await action.boundingBox()
      const offset = await action.evaluate((el) => getComputedStyle(el).outlineOffset)
      check("V5 card action 24px with inset ring", box?.width === 24 && box?.height === 24 && offset === "-2px", { box, offset })
      await page.screenshot({ path: `${OUT}/v5-card-action-focus.png`, clip: { x: 0, y: 0, width: 360, height: 500 } })
    } else check("V5 card action 24px with inset ring", false, "no project card New thread button found")
  }
  await browser.close()
}

console.log(JSON.stringify(results, null, 1))
