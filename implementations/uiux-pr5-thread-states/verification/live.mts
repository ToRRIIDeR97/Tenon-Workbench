// UI/UX PR5 verification: mounts the real DiffChanges and Markdown components from the dev server.
// Run from tenon/packages/app as e2e/.uiux-pr5.mts: node --experimental-strip-types e2e/.uiux-pr5.mts <outdir>
import { chromium } from "@playwright/test"

const OUT = process.argv[2]!
const check = (id: string, pass: boolean, detail: unknown) => console.log(pass ? "PASS" : "FAIL", id, JSON.stringify(detail))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: "light" })
await page.goto("http://localhost:4445/")
await page.waitForTimeout(4000)
const result = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType("resource").map((entry) => entry.name)
  const url = (part: string) => loaded.find((name) => name.includes(part))!
  const { render } = await import(url("/deps/solid-js_web.js"))
  const { createComponent } = await import(url("/deps/solid-js.js"))
  const pkg = "/@fs/C:/Users/sense/OneDrive/Documents/GitHub/Tenon-Workbench/.claude/worktrees/clarifications-fixes-needed-5ea1ff/tenon/packages"
  const { DiffChanges } = await import(`${pkg}/ui/src/components/diff-changes.tsx`)
  const { Markdown } = await import(`${pkg}/session-ui/src/components/markdown.tsx`)
  const root = document.createElement("div")
  root.id = "pr5-root"
  root.style.cssText = "position:fixed;inset:0;z-index:9999;padding:32px;width:720px;background:var(--v2-background-bg-base)"
  document.body.appendChild(root)
  const diff = document.createElement("div")
  root.appendChild(diff)
  render(() => createComponent(DiffChanges, { changes: { additions: 12, deletions: 0 } }), diff)
  const out: Record<string, unknown> = {}
  await new Promise((resolve) => setTimeout(resolve, 300))
  out.deletions = diff.querySelector('[data-slot="diff-changes-deletions"]')?.textContent ?? null
  const add = diff.querySelector('[data-slot="diff-changes-additions"]')
  out.addColor = add ? getComputedStyle(add).color : null
  if (Markdown) {
    const md = document.createElement("div")
    root.appendChild(md)
    render(() => createComponent(Markdown, { text: "| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted" }), md)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const table = md.querySelector("table")
    const quote = md.querySelector("blockquote")
    out.tableWidth = table?.querySelector("tr")?.getBoundingClientRect().width ?? null
    out.containerWidth = md.getBoundingClientRect().width
    out.quoteRule = quote ? getComputedStyle(quote).borderInlineStartWidth : null
  }
  return out
})
check("V2 zero deletions omitted", result.deletions === null, result)
check("V4 markdown table fills the column", typeof result.tableWidth === "number" && Math.abs((result.tableWidth as number) - (result.containerWidth as number)) <= 2, result)
check("V4 quote rule 3px", result.quoteRule === "3px", result)
await page.screenshot({ path: `${OUT}/v-pr5.png`, clip: { x: 0, y: 0, width: 800, height: 400 } })
await browser.close()
