import { describe, expect, test } from "bun:test"
import { ChatDisplay } from "@tenon/core/chat-display"

// Every agent kind hears where Project work goes and to keep a checklist, since harnesses get only `abilities`.
describe("ChatDisplay.abilities", () => {
  test.each(["harness", "native", "reply"] as const)("%s agents get the checklist and Tenon work guidance", (kind) => {
    const text = ChatDisplay.abilities(kind)
    expect(text).toContain(ChatDisplay.checklistGuidance)
    expect(text).toContain(ChatDisplay.workGuidance)
    expect(text).toContain("timeline_update")
    expect(text).toContain("notes_write")
    expect(text).toContain("gh issue create")
  })

  test.each(["harness", "native", "reply"] as const)("%s agents can show files with a view block", (kind) => {
    const text = ChatDisplay.abilities(kind)
    expect(text).toContain(ChatDisplay.viewGuidance)
    expect(text).toContain("```view")
    expect(text).toContain(".glb")
  })
})
