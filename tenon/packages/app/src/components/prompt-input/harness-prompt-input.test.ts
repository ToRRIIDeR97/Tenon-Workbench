import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { buildRequestParts, harnessPromptInput } from "./build-request-parts"
import { SKILL_REFERENCE_MIME } from "@/utils/skill-reference"

const skill = (name: string, start: number) => ({
  type: "file" as const,
  path: name,
  content: `/${name}`,
  start,
  end: start + name.length + 1,
  mime: SKILL_REFERENCE_MIME,
  url: `tenon-skill://${name}`,
})

const dataText = (uri: string) => {
  const comma = uri.indexOf(",")
  const header = uri.slice(0, comma)
  const body = uri.slice(comma + 1)
  return header.endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body)
}

// AC-1: the visible message is what the user typed; a skill's instructions travel as a hidden text attachment.
describe("harnessPromptInput", () => {
  const prompt: Prompt = [{ type: "text", content: "fix ", start: 0, end: 4 }, skill("review", 4)]
  const { requestParts } = buildRequestParts({
    prompt,
    context: [],
    images: [],
    text: "fix /review",
    messageID: "msg_1",
    sessionID: "ses_1",
    sessionDirectory: "/repo",
    skill: (name) => (name === "review" ? "Read the diff line by line." : undefined),
  })
  const input = harnessPromptInput(requestParts)

  test("the text holds only the user's words", () => {
    expect(input.text).toBe("fix /review")
    expect(input.text).not.toContain("Read the diff line by line.")
    expect(input.text).not.toContain("<skill")
  })

  test("each skill becomes a data:text/plain attachment named for the skill", () => {
    const files = input.files.filter((file) => file.uri.startsWith("data:text/plain"))
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe("review skill")
    expect(dataText(files[0]!.uri)).toContain("Read the diff line by line.")
    expect(dataText(files[0]!.uri)).toContain('<skill name="review">')
  })

  test("a harness's own skill (no content) still reaches the harness as an attachment", () => {
    const own = buildRequestParts({
      prompt: [skill("simplify", 0)],
      context: [],
      images: [],
      text: "/simplify",
      messageID: "msg_2",
      sessionID: "ses_1",
      sessionDirectory: "/repo",
    })
    const value = harnessPromptInput(own.requestParts)
    expect(value.text).toBe("/simplify")
    expect(value.files.map((file) => file.name)).toEqual(["simplify skill"])
    expect(dataText(value.files[0]!.uri)).toContain('"simplify" skill')
  })
})
