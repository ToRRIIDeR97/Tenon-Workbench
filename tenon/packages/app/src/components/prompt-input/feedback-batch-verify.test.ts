import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { buildRequestParts, harnessPromptInput } from "./build-request-parts"
import { filterHarnessModels } from "./harness-choice"
import { pickerSkills } from "@/utils/skill-reference"

const build = (prompt: Prompt, text: string, context: Parameters<typeof buildRequestParts>[0]["context"] = []) =>
  buildRequestParts({
    prompt,
    context,
    images: [],
    text,
    messageID: "msg_v",
    sessionID: "ses_v",
    sessionDirectory: "/repo",
  })

describe("verification: harnessPromptInput", () => {
  test("a message without skills keeps its text and adds no attachment", () => {
    const value = harnessPromptInput(
      build([{ type: "text", content: "hello", start: 0, end: 5 }], "hello").requestParts,
    )
    expect(value.text).toBe("hello")
    expect(value.files).toEqual([])
    expect(value.agents).toEqual([])
  })

  test("a quote note still reaches the harness in the text, as before", () => {
    const value = harnessPromptInput(
      build([{ type: "text", content: "why?", start: 0, end: 4 }], "why?", [
        { key: "quote:1", type: "quote", text: "earlier line" },
      ]).requestParts,
    )
    expect(value.text).toContain("why?")
    expect(value.text).toContain("> earlier line")
  })

  test("a referenced file keeps its URI and mention", () => {
    const value = harnessPromptInput(
      build(
        [
          { type: "text", content: "see ", start: 0, end: 4 },
          { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 4, end: 13 },
        ],
        "see @src/a.ts",
      ).requestParts,
    )
    expect(value.files).toHaveLength(1)
    expect(value.files[0]!.uri.startsWith("file://")).toBe(true)
    expect(value.files[0]!.mention).toEqual({ start: 4, end: 13, text: "@src/a.ts" })
  })
})

describe("verification: filterHarnessModels", () => {
  test("a model without a name is matched by id", () => {
    expect(filterHarnessModels([{ id: "gpt-5.5" }], "gpt")).toEqual([{ id: "gpt-5.5" }])
  })
})

describe("verification: pickerSkills", () => {
  test("a catalog without the harness still lists Tenon's skills once", () => {
    expect(
      pickerSkills({ tenon: [{ name: "a" }, { name: "a", enabled: true }], harnesses: [] }, "missing").map(
        (skill) => skill.name,
      ),
    ).toEqual(["a"])
  })
})
