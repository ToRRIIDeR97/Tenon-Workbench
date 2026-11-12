import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// PR1 of the UI/UX review (implementations/uiux-pr1-contrast): keyboard reachability and class fixes that the
// headless verification measures live. These read the source because the styles only resolve in a browser.
const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")

describe("composer", () => {
  const prompt = read("session-ui/src/v2/components/prompt-input/index.tsx")

  // AC-3: the send button draws the shared 2px focus ring.
  test("send button has a focus-visible ring", () => {
    const send = prompt.slice(prompt.indexOf('data-action="prompt-submit"'))
    const cls = send.slice(send.indexOf('class="'), send.indexOf('"', send.indexOf('class="') + 7))
    expect(cls).toContain("focus-visible:outline-2")
    expect(cls).toContain("focus-visible:outline-v2-border-border-focus")
  })

  // AC-4: attachment and comment remove buttons are 20px and show when focus is inside the chip.
  test("remove buttons are larger and appear on keyboard focus", () => {
    const removes = prompt.match(/class="absolute -top-1 -end-1[^"]*"/g) ?? []
    expect(removes.length).toBe(2)
    for (const cls of removes) {
      expect(cls).toContain("size-5")
      expect(cls).toContain("group-focus-within:opacity-100")
    }
  })

  // AC-4: an image attachment opens from the keyboard (a button, not a clickable img).
  test("image attachment is a button", () => {
    expect(prompt).not.toMatch(/<img[^>]*onClick=/)
  })
})

describe("sidebar", () => {
  // AC-5: project card actions are 24px and their focus ring is drawn inside the clipped area.
  test("project card actions are 24px with an inset ring", () => {
    const sidebar = read("app/src/components/second-brain-sidebar.tsx")
    const header = sidebar.slice(sidebar.indexOf("<div class={headerActionsClass}>"))
    const block = header.slice(0, header.indexOf("<MenuV2.Portal>"))
    expect(block).not.toContain('size="small"\n              icon')
    expect(block.match(/size="normal"/g)?.length).toBe(2)
    expect(block.match(/focus-visible:!outline-offset-\[-2px\]/g)?.length).toBe(2)
  })
})

describe("thread", () => {
  // AC-6: "Show all" changed files is a real button that shows on keyboard focus.
  test("diff Show all toggle is a button", () => {
    const timeline = read("app/src/pages/session/timeline/message-timeline.tsx")
    expect(timeline).not.toMatch(/<span data-slot="session-turn-diffs-toggle" onClick/)
    expect(timeline).toMatch(/<button[^>]*data-slot="session-turn-diffs-toggle"/)
    const css = read("session-ui/src/components/session-turn.css")
    expect(css).toMatch(
      /\[data-component="session-turn-diffs-group"\]:focus-within \[data-slot="session-turn-diffs-toggle"\]/,
    )
  })
})

describe("connect provider dialog", () => {
  // AC-7: the label-to-field gap classes are valid Tailwind (no "gap-2px-3" / "gap-2font-medium").
  test("labels use valid gap classes", () => {
    const dialog = read("app/src/components/dialog-connect-provider.tsx")
    expect(dialog).not.toMatch(/gap-2px-3|gap-2font-medium/)
  })
})
