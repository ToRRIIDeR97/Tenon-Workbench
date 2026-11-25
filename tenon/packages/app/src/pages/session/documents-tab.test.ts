import { describe, expect, test } from "bun:test"
import { threadDocuments } from "./documents"

const write = (callID: string, filePath: string, status = "completed") => ({
  type: "tool",
  tool: "write",
  callID,
  state: { status, input: { filePath, content: "# Plan" } },
})
const text = (value: string) => ({ type: "text", text: value })

describe("threadDocuments", () => {
  test("lists written and linked documents, newest first with the one being written on top", () => {
    const documents = threadDocuments(
      [
        { created: 1, parts: [write("a", "C:/repo/docs/plan.md"), text("See [the report](reports/q3.pdf).")] },
        { created: 2, parts: [text("Updated `data/sales.csv:10` and `docs/plan.md`.")] },
        { created: 3, parts: [write("b", "C:/repo/notes/draft.md", "running")] },
      ],
      "C:/repo",
    )
    expect(documents.map((item) => [item.path, item.wrote, item.writing])).toEqual([
      ["notes/draft.md", true, true],
      ["docs/plan.md", true, false],
      ["data/sales.csv", false, false],
      ["reports/q3.pdf", false, false],
    ])
    expect(documents.find((item) => item.path === "docs/plan.md")?.at).toBe(2)
  })

  test("keeps only viewer documents, and only paths inside the folder or plain absolute ones outside", () => {
    const documents = threadDocuments(
      [
        {
          created: 1,
          parts: [
            write("a", "C:/repo/src/app.ts"),
            write("b", "C:/repo/design.html"),
            text("[web](https://example.com/a.pdf) [up](../secret.md) `C:/other/brief.docx` `C:/Other/Brief.docx`"),
          ],
        },
      ],
      "C:/repo",
    )
    expect(documents).toEqual([{ path: "C:/other/brief.docx", outside: true, wrote: false, writing: false, at: 1 }])
  })
})
