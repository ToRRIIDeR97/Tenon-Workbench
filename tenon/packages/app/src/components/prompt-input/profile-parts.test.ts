import { describe, expect, test } from "bun:test"
import { buildRequestParts, harnessPromptInput } from "./build-request-parts"

describe("model profile parts", () => {
  test("a due profile travels as a hidden attachment, not as message text", () => {
    const { requestParts } = buildRequestParts({
      prompt: [{ type: "text", content: "hi", start: 0, end: 2 }],
      context: [],
      images: [],
      text: "hi",
      messageID: "msg_p",
      sessionID: "ses_p",
      sessionDirectory: "/repo",
      profile: { model: "deepseek-v4.1-flash", rules: "- Run the tests" },
    })
    const value = harnessPromptInput(requestParts)
    expect(value.text).toBe("hi")
    expect(value.files.map((file) => file.name)).toEqual(["deepseek-v4.1-flash profile"])
    expect(decodeURIComponent(value.files[0]!.uri.split(",")[1]!)).toContain("- Run the tests")
  })
})
