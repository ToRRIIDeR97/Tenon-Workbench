import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partUpdated,
  setupTimeline,
  shell,
  status,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("groups singleton and separated context operations at correct boundaries", async ({ page }) => {
  const parts = [
    toolPart("prt_boundary_01_read", "read", "completed", { filePath: "src/a.ts" }),
    textPart("prt_boundary_02_text", "Boundary text"),
    toolPart("prt_boundary_03_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
    toolPart("prt_boundary_04_grep", "grep", "completed", { path: ".", pattern: "stable" }),
    shell("prt_boundary_05_shell", "completed", "done"),
    toolPart("prt_boundary_06_list", "list", "completed", { path: "src" }),
  ]
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  const cards = page.locator('[data-timeline-row="TurnSteps"]')
  await expect(cards).toHaveCount(2)
  const rowOrder = await page
    .locator("[data-timeline-row]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-row")))
  expect(rowOrder.filter((row) => row === "TurnSteps" || row === "AssistantPart")).toEqual([
    "TurnSteps",
    "AssistantPart",
    "TurnSteps",
  ])
  await expect(page.locator('[data-timeline-row="AssistantPart"]')).toContainText("Boundary text")

  const first = cards.nth(0)
  await expect(first.locator('[data-slot="turn-steps-rows"] > [data-slot="turn-steps-item"]')).toHaveCount(1)
  await expect(first.locator('[data-timeline-part-id="prt_boundary_01_read"]')).toBeVisible()

  const second = cards.nth(1)
  const groups = second.locator('[data-slot="turn-steps-rows"] > [data-slot="turn-steps-item"]')
  await expect(groups).toHaveCount(3)
  const search = groups.nth(0)
  await expect(search.locator(':scope > [data-slot="turn-steps-row"]')).toContainText("Searched 2 times")
  await search.locator(':scope > [data-slot="turn-steps-row"]').click()
  for (const id of ["prt_boundary_03_glob", "prt_boundary_04_grep"]) {
    await expect(search.locator(`[data-timeline-part-id="${id}"]`), id).toBeVisible()
  }
  await expect(groups.nth(1)).toHaveAttribute("data-timeline-part-id", "prt_boundary_05_shell")
  await expect(groups.nth(2)).toHaveAttribute("data-timeline-part-id", "prt_boundary_06_list")
  await expect(second.locator('[data-timeline-part-id="prt_boundary_01_read"]')).toHaveCount(0)
  await expect(first.locator('[data-timeline-part-id="prt_boundary_06_list"]')).toHaveCount(0)
})

test("reducer-hardening: converges when idle arrives before final part and message completion", async ({ page }) => {
  const textID = "prt_event_order_text"
  const assistant = assistantMessage([textPart(textID, "Partial")], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
  await timeline.send(status("busy"), 100)
  await timeline.send(status("idle"), 100)
  await timeline.send(partUpdated(textPart(textID, "Final after early idle")), 120)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant.info)), 250)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${textID}"]`)).toContainText("Final after early idle")
})
