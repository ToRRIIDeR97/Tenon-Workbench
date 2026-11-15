import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptInputV2Attachments } from "../../session-ui/src/v2/components/prompt-input/attachments"
import type { PromptInputV2Prompt } from "../../session-ui/src/v2/components/prompt-input/types"

test("rejects a duplicate native clipboard attachment in the V2 prompt store", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const duplicate = Promise.withResolvers<void>()
    const files = [
      new File(["hello"], "clipboard-1.txt", { type: "text/plain" }),
      new File(["hello"], "clipboard-2.txt", { type: "text/plain" }),
    ]
    const attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: duplicate.resolve,
      onError: () => undefined,
      readClipboardImage: async () => files.shift() ?? null,
    })
    const event = {
      clipboardData: { items: [], getData: () => "" },
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    } as unknown as ClipboardEvent

    await attachments.handlePaste(event)
    await attachments.handlePaste(event)
    await duplicate.promise

    expect(state.prompt).toHaveLength(1)
    dispose()
  })
})

test("rejects desktop duplicates and keeps changed files in the V2 prompt store", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const duplicates: string[] = []
    const attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: () => duplicates.push("duplicate"),
      onError: () => undefined,
      getPathForFile: (file) => (file.name === "browser.txt" ? "" : `/tmp/${file.name}`),
    })
    const first = new File(["first"], "a.txt", { type: "text/plain" })
    const second = new File(["second"], "b.txt", { type: "text/plain" })

    await attachments.addAttachments([first, second])
    await attachments.addAttachments([first, second])
    expect(state.prompt).toHaveLength(2)
    expect(duplicates).toEqual(["duplicate", "duplicate"])

    await attachments.addAttachments([new File(["edited"], "a.txt", { type: "text/plain" })])
    expect(state.prompt).toHaveLength(3)

    await attachments.addAttachments([
      new File(["same"], "browser.txt", { type: "text/plain" }),
      new File(["same"], "browser.txt", { type: "text/plain" }),
    ])
    expect(state.prompt).toHaveLength(4)
    expect(duplicates).toHaveLength(3)
    dispose()
  })
})
