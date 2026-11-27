import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  turnStep,
  turnStepGroup,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("preserves a collapsed context group through count and status updates", async ({ page }) => {
  const ids = ["prt_closed_01_glob", "prt_closed_02_grep", "prt_closed_03_list"]
  const inputs = {
    glob: { path: ".", pattern: "**/*.ts" },
    grep: { path: ".", pattern: "stable" },
    list: { path: "src" },
  }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [toolPart(ids[0]!, "glob", "running", inputs.glob), toolPart(ids[1]!, "grep", "running", inputs.grep)],
        { completed: false },
      ),
    ],
  })
  const group = page.locator(
    '[data-slot="turn-steps-rows"] > [data-slot="turn-steps-item"]:not([data-timeline-part-id])',
  )
  const trigger = group.locator(':scope > [data-slot="turn-steps-row"]')
  await expect(group).toHaveCount(1)
  await expect(trigger).toContainText("Searched 2 times")
  await expect(trigger.locator('[data-slot="turn-steps-step-running"]')).toHaveCount(1)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.send(partUpdated(toolPart(ids[0]!, "glob", "completed", inputs.glob)), 100)
  await timeline.send(partUpdated(toolPart(ids[1]!, "grep", "completed", inputs.grep)), 100)
  await timeline.send(partUpdated(toolPart(ids[2]!, "list", "completed", inputs.list)), 300)
  await expect(trigger).toContainText("Searched 3 times")
  await expect(trigger.locator('[data-slot="turn-steps-step-running"]')).toHaveCount(0)
  await expect(group).toHaveCount(1)
  await expect(turnStepGroup(page, "Searched 3 times")).toHaveCount(1)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(turnStep(page, ids[2]!).item).toHaveCount(0)
})
