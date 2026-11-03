import { expect, test } from "@playwright/test"
import { openApp, sidebar } from "./open-app"

// P1 · S4 sidebar (implementations/notes-command-centre/implementation.md)

const width = (page: import("@playwright/test").Page) =>
  sidebar(page).evaluate((element) => element.getBoundingClientRect().width)

test.use({ viewport: { width: 1280, height: 800 } })

test("AC-1.1 rail and panel share one outlined, neutral container", async ({ page }) => {
  await openApp(page)
  await page.goto("/")
  const style = await sidebar(page).evaluate((element) => {
    const css = getComputedStyle(element)
    return {
      borderWidth: parseFloat(css.borderTopWidth),
      radius: parseFloat(css.borderTopLeftRadius),
    }
  })
  expect(style.borderWidth).toBeGreaterThanOrEqual(1)
  expect(style.radius).toBeGreaterThan(0)
  // The rail and the Projects panel are both inside the container.
  await expect(sidebar(page).locator("nav")).toHaveCount(1)
  await expect(sidebar(page).locator("aside")).toHaveCount(1)
  // No accent tint: a color-mix with the accent container computes to `color(srgb …)`; neutral
  // surfaces compute to plain rgb()/none.
  const backgrounds = await sidebar(page).evaluate((element) =>
    [element, ...element.querySelectorAll("aside, nav")].flatMap((node) => {
      const css = getComputedStyle(node)
      return [css.backgroundImage, css.backgroundColor]
    }),
  )
  for (const background of backgrounds) expect(background).not.toMatch(/color\(srgb/)
})

test("AC-1.2 toggling animates the container between rail-only and rail plus panel", async ({ page }) => {
  await openApp(page)
  await page.goto("/")
  await expect.poll(() => width(page)).toBeGreaterThanOrEqual(300)
  expect(await width(page)).toBeLessThanOrEqual(360)

  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  const closing = await sidebar(page).evaluate((element) => {
    const css = getComputedStyle(element)
    return { property: css.transitionProperty, duration: css.transitionDuration, easing: css.transitionTimingFunction }
  })
  expect(closing.property).toContain("width")
  expect(closing.duration).toContain("0.2s")
  expect(closing.easing).toContain("cubic-bezier(0.3, 0, 0.8, 0.15)")
  await expect.poll(() => width(page)).toBeLessThanOrEqual(90)
  expect(await width(page)).toBeGreaterThanOrEqual(80)

  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  const opening = await sidebar(page).evaluate((element) => {
    const css = getComputedStyle(element)
    return { duration: css.transitionDuration, easing: css.transitionTimingFunction }
  })
  expect(opening.duration).toContain("0.3s")
  expect(opening.easing).toContain("cubic-bezier(0.05, 0.7, 0.1, 1)")
  await expect.poll(() => width(page)).toBeGreaterThanOrEqual(300)
})

test("AC-1.3 reduced motion removes the transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await openApp(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  const duration = await sidebar(page).evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(duration.split(",").every((value) => parseFloat(value) === 0)).toBe(true)
})

test("AC-1.4 rail destinations keep their order and Settings opens the dialog", async ({ page }) => {
  await openApp(page)
  await page.goto("/")
  const ids = await sidebar(page)
    .locator("nav [data-sidebar-item]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-sidebar-item")))
  // AC-7.1 replaces Activity with Command Centre in PR4 (plan author update).
  expect(ids).toEqual(["overview", "projects", "calendar", "command", "settings"])
  await sidebar(page).locator('[data-sidebar-item="settings"]').click()
  await expect(page.locator('[data-component="dialog-v2"][data-variant="settings"]')).toBeVisible()
})
