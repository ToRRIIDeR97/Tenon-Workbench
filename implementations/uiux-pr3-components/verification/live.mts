// UI/UX PR3 verification: mounts the real approval card from the dev server and measures the split buttons.
// Run from tenon/packages/app as e2e/.uiux-pr3.mts: node --experimental-strip-types e2e/.uiux-pr3.mts <outdir>
import { chromium } from "@playwright/test"

const OUT = process.argv[2]!
const check = (id: string, pass: boolean, detail: unknown) => console.log(pass ? "PASS" : "FAIL", id, JSON.stringify(detail))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, colorScheme: "dark" })
await page.goto("http://localhost:4445/")
await page.waitForTimeout(4000)
await page.evaluate(async () => {
  const loaded = performance.getEntriesByType("resource").map((entry) => entry.name)
  const url = (part: string) => loaded.find((name) => name.includes(part))!
  const { render } = await import(url("/deps/solid-js_web.js"))
  const { createComponent } = await import(url("/deps/solid-js.js"))
  const { LanguageProvider } = await import(url("/src/context/language.tsx"))
  const { PlatformProvider } = await import(url("/src/context/platform.tsx"))
  const { SessionPermissionDock } = await import("/src/pages/session/composer/session-permission-dock.tsx")
  const root = document.createElement("div")
  root.id = "pr3-root"
  root.style.cssText = "position:fixed;inset:0;z-index:9999;padding:32px;max-width:760px;background:var(--v2-background-bg-deep)"
  document.body.appendChild(root)
  const platform = { platform: "web", version: "dev", openExternal: () => {}, restart: async () => {}, notify: async () => {} }
  render(
    () =>
      createComponent(PlatformProvider, {
        value: platform,
        get children() {
          return createComponent(LanguageProvider, {
            get children() {
              return createComponent(SessionPermissionDock, {
                request: { id: "p1", sessionID: "s", permission: "bash", patterns: ["bun test"], metadata: {}, always: [] },
                responding: false,
                onDecide: () => {},
                onAllowThread: () => {},
              })
            },
          })
        },
      }),
    root,
  )
})
await page.waitForTimeout(1500)

const splits = await page.evaluate(() =>
  [...document.querySelectorAll('#pr3-root [data-slot="permission-footer-actions"] > *')].map((wrapper) => {
    const style = getComputedStyle(wrapper)
    const buttons = [...wrapper.querySelectorAll("button")].map((button) => button.getBoundingClientRect())
    return {
      radius: style.borderTopLeftRadius,
      overflow: style.overflow,
      gap: buttons.length === 2 ? Math.round(buttons[1]!.left - buttons[0]!.right) : null,
    }
  }),
)
check("V2 split buttons are one clipped pill with no gap", splits.length === 2 && splits.every((item) => item.overflow === "hidden" && item.gap === 0 && parseFloat(item.radius) >= 14), splits)

await page.locator('#pr3-root button[aria-label="More ways to allow"]').focus()
await page.keyboard.press("Shift+Tab")
await page.keyboard.press("Tab")
const ring = await page.evaluate(() => {
  const style = getComputedStyle(document.activeElement!)
  return { label: document.activeElement?.getAttribute("aria-label"), style: style.outlineStyle, offset: style.outlineOffset }
})
check("V2 chevron focus ring is inset", ring.style !== "none" && ring.offset === "-2px", ring)
await page.screenshot({ path: `${OUT}/v2-approval.png`, clip: { x: 0, y: 0, width: 800, height: 260 } })
await browser.close()
