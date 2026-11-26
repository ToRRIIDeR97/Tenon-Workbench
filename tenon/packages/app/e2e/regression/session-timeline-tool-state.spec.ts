import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  turnStep,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("updates expanded web search links without resetting expansion", async ({ page }) => {
  const searchID = "prt_websearch_mutation"
  const input = { query: "timeline stability" }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([toolPart(searchID, "websearch", "completed", input, { output: "https://example.com/one" })]),
    ],
  })
  const step = turnStep(page, searchID)
  await step.row.click()
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toHaveText("https://example.com/one")
  await timeline.send(
    partUpdated(
      toolPart(searchID, "websearch", "completed", input, {
        output: "https://example.com/one\nhttps://example.com/two",
      }),
    ),
    300,
  )
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toHaveText("https://example.com/one\nhttps://example.com/two")
  await expect(step.detail).toBeVisible()
})

test("preserves an expanded tool error card across duplicate delivery", async ({ page }) => {
  const toolID = "prt_duplicate_error"
  const failed = toolPart(toolID, "bash", "error", { command: "exit 1" }, { error: "Command failed visibly" })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistantMessage([failed])] })
  const step = turnStep(page, toolID)
  await step.row.click()
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toHaveText("Command failed visibly")
  await timeline.send(partUpdated(failed), 150)
  await timeline.send(partUpdated(failed), 250)
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toHaveText("Command failed visibly")
  await expect(step.detail).toBeVisible()
  await expect(page.locator(`[data-timeline-part-id="${toolID}"]`)).toHaveCount(1)
})

test("renders multiple question answers and preserves open state on answer updates", async ({ page }) => {
  const questionID = "prt_multi_question"
  const input = {
    questions: [
      { header: "First", question: "First choice?", options: [] },
      { header: "Second", question: "Second choice?", options: [], multiple: true },
    ],
  }
  const answered = (answers: string[][]) =>
    toolPart(questionID, "question", "completed", input, {
      title: "Asked 2 questions",
      output: questionOutput(input.questions, answers),
      metadata: { answers },
    })
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([answered([["A"], ["B", "C"]])])],
  })
  const step = turnStep(page, questionID)
  await expect(step.row).toContainText("First choice?")
  await step.row.click()
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toContainText('"First choice?"="A"')
  await expect(step.detail).toContainText('"Second choice?"="B, C"')
  await timeline.send(partUpdated(answered([["Updated"], ["B", "C"]])), 300)
  await expect(step.row).toHaveAttribute("aria-expanded", "true")
  await expect(step.detail).toContainText('"First choice?"="Updated"')
  await expect(step.detail).toContainText('"Second choice?"="B, C"')
})

function questionOutput(questions: { question: string }[], answers: string[][]) {
  const formatted = questions
    .map((item, index) => `"${item.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`)
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}
