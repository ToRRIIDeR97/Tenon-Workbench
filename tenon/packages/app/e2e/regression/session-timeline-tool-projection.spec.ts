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

test("renders every tool error outcome without leaking hidden tools", async ({ page }) => {
  const ordinary = ["bash", "edit", "write", "apply_patch", "webfetch", "websearch", "task", "skill", "mcp_probe"]
  const parts = ordinary.map((tool, index) =>
    toolPart(`prt_error_${index}`, tool, "error", errorInput(tool), { error: `${tool} failed visibly` }),
  )
  parts.push(
    toolPart("prt_question_dismissed", "question", "error", questionInput(), {
      error: "The user dismissed this question",
    }),
    toolPart("prt_question_error", "question", "error", questionInput(), { error: "Question transport failed" }),
    toolPart("prt_todo_error", "todowrite", "error", { todos: [] }, { error: "Hidden todo failure" }),
  )
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  const summary = page.locator('[data-timeline-row="TurnSteps"] [data-component="turn-steps-summary"]')
  await expect(summary.locator('[data-slot="turn-steps-failed"]')).toHaveText(`${ordinary.length + 1} steps failed`)
  await expect(summary.locator('[data-slot="turn-steps-declined"]')).toHaveText("1 declined")
  for (const name of ["Edited 3 files", "Fetched 2 pages"]) {
    const group = turnStepGroup(page, name)
    await group.locator(':scope > [data-slot="turn-steps-row"]').click()
    await expect(group.locator(':scope > [data-slot="turn-steps-row"]')).toHaveAttribute("aria-expanded", "true")
  }
  for (let index = 0; index < ordinary.length; index++) {
    const step = turnStep(page, `prt_error_${index}`)
    await expect(step.row).toBeVisible()
    await step.row.click()
    await expect(step.row).toHaveAttribute("aria-expanded", "true")
    await expect(step.detail).toHaveText(`${ordinary[index]} failed visibly`)
  }
  const dismissed = turnStep(page, "prt_question_dismissed")
  await expect(dismissed.row.locator('[data-slot="turn-steps-declined"]')).toHaveText("Declined")
  await dismissed.row.click()
  await expect(dismissed.detail).toHaveText(/dismissed/i)
  const failedQuestion = turnStep(page, "prt_question_error")
  await expect(failedQuestion.row.locator('[data-slot="turn-steps-declined"]')).toHaveCount(0)
  await failedQuestion.row.click()
  await expect(failedQuestion.detail).toHaveText("Question transport failed")
  await expect(page.locator('[data-timeline-part-id="prt_todo_error"]')).toHaveCount(0)
  await expect(page.getByText("Hidden todo failure")).toHaveCount(0)
})

test("transitions shell and question through running error outcomes", async ({ page }) => {
  const shellID = "prt_transition_error_shell"
  const questionID = "prt_transition_error_question"
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(shellID, "bash", "pending", { command: "exit 1" }),
          toolPart(questionID, "question", "pending", questionInput()),
        ],
        { completed: false },
      ),
    ],
  })
  await timeline.waitForPart(shellID)
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(toolPart(shellID, "bash", "running", { command: "exit 1" })), 120)
  await timeline.send(partUpdated(toolPart(questionID, "question", "running", questionInput())), 180)
  const shell = turnStep(page, shellID)
  await expect(shell.row).toHaveAttribute("data-running", "")
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(
    partUpdated(toolPart(shellID, "bash", "error", { command: "exit 1" }, { error: "Command exited 1" })),
    180,
  )
  await timeline.send(
    partUpdated(
      toolPart(questionID, "question", "error", questionInput(), { error: "The user dismissed this question" }),
    ),
    250,
  )

  const summary = page.locator('[data-timeline-row="TurnSteps"] [data-component="turn-steps-summary"]')
  await expect(summary.locator('[data-slot="turn-steps-failed"]')).toHaveText("1 step failed")
  await expect(shell.row).not.toHaveAttribute("data-running", "")
  await shell.row.click()
  await expect(shell.detail).toHaveText("Command exited 1")
  const question = turnStep(page, questionID)
  await expect(question.row.locator('[data-slot="turn-steps-declined"]')).toHaveText("Declined")
  await question.row.click()
  await expect(question.detail).toHaveText(/dismissed/i)
})

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}

function errorInput(tool: string) {
  if (tool === "bash") return { command: "exit 1" }
  if (["edit", "write"].includes(tool)) return { filePath: "src/error.ts", content: "" }
  if (tool === "apply_patch") return { files: ["src/error.ts"] }
  if (tool === "webfetch") return { url: "https://example.com" }
  if (tool === "websearch") return { query: "failure" }
  if (tool === "task") return { description: "Fail task", subagent_type: "explore" }
  if (tool === "skill") return { name: "failure" }
  return { target: "failure" }
}
