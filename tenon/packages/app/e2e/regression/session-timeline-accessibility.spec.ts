import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  setupTimeline,
  shell,
  turnStep,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("space activates a focused timeline button instead of scrolling", async ({ page }) => {
  const shellID = "prt_space_button_shell"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([shell(shellID, "completed", lines(5))])],
    settings: { shellToolPartsExpanded: false },
    reducedMotion: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const step = turnStep(page, shellID)
  await expect(step.row).toHaveAttribute("aria-expanded", "false")
  await step.row.focus()
  await expect(step.row).toBeFocused()
  const before = await scroller.evaluate((element) => element.scrollTop)
  await step.row.press("Space")
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toContainText("line 5")
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
