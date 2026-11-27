import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  setupTimeline,
  toolPart,
  turnStep,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("renders completed write content", async ({ page }) => {
  const id = "prt_file_projection_write"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(id, "write", "completed", { filePath: "src/write.ts", content: "export const written = true\n" }),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })

  const step = turnStep(page, id)
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.row).toContainText("src/write.ts")
  const diff = step.detail.locator('[data-slot="turn-steps-diff"] [data-component="file"][data-mode="diff"]')
  await expect(diff).toHaveCount(1)
  await expect(diff).toBeVisible()
  await expect(diff).toContainText("export const written = true")
})

test("renders a completed single-file patch", async ({ page }) => {
  const id = "prt_file_projection_single_patch"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          id,
          "apply_patch",
          "completed",
          { files: ["src/a.ts"] },
          {
            metadata: {
              files: [
                {
                  filePath: "src/a.ts",
                  relativePath: "src/a.ts",
                  type: "update",
                  additions: 1,
                  deletions: 1,
                  before: "export const value = 1\n",
                  after: "export const value = 2\n",
                },
              ],
            },
          },
        ),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })

  const step = turnStep(page, id)
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  const diff = step.detail.locator('[data-slot="turn-steps-diff"] [data-component="file"][data-mode="diff"]')
  await expect(diff).toHaveCount(1)
  await expect(diff).toBeVisible()
  await expect(diff).toContainText("export const value = 2")
})
