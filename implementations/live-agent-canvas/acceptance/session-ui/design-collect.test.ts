import { describe, expect, test } from "bun:test"
import { collectDesigns, collectToolDesigns, designID } from "../../../../tenon/packages/session-ui/src/components/design-fence"

const messages = [{ id: "m1", role: "assistant" }]
const text = (t: string) => ({ m1: [{ id: "p1", type: "text", text: t }] })

// AC-7: a canvas fence that is still streaming is a design with a key that survives its close.
describe("AC-7 streaming canvas designs", () => {
  const open = 'Here:\n```html canvas title="Hero"\n<style>a{}</style><main><h1>Pri'
  const closed = 'Here:\n```html canvas title="Hero"\n<style>a{}</style><main><h1>Pricing</h1></main>\n```\n'

  test("left out by default, as today", () => {
    expect(collectDesigns(messages, text(open))).toEqual([])
  })

  test("included with streaming: true and a stable key", () => {
    const [design] = collectDesigns(messages, text(open), [], undefined, { streaming: true })
    expect(design).toMatchObject({ key: "p1:0", streaming: true, title: "Hero", canvas: true })
    expect(design.source).toContain("<h1>Pri")
  })

  test("same key once closed, with the checksum id", () => {
    const [design] = collectDesigns(messages, text(closed), [], undefined, { streaming: true })
    expect(design.key).toBe("p1:0")
    expect(design.streaming ?? false).toBe(false)
    expect(design.id).toBe(designID("<style>a{}</style><main><h1>Pricing</h1></main>"))
  })

  test("second fence in a part gets index 1", () => {
    const two = closed + '```html canvas title="Two"\n<p>x'
    const designs = collectDesigns(messages, text(two), [], undefined, { streaming: true })
    expect(designs.map((d) => d.key)).toEqual(["p1:0", "p1:1"])
  })
})

// AC-8: a write tool call to an .html file is a canvas design, live while it streams.
describe("AC-8 collectToolDesigns", () => {
  const parts = (status: string, content: string, filePath = "designs/hero.html") => ({
    m1: [{ id: "t1", type: "tool", tool: "write", callID: "call_1", state: { status, input: { filePath, content } } }],
  })
  test("streaming write", () => {
    const [design] = collectToolDesigns(messages, parts("pending", "<main><h1>Hi"))
    expect(design).toMatchObject({ key: "call_1", streaming: true, canvas: true, title: "hero.html" })
  })
  test("completed write keeps the key", () => {
    const [design] = collectToolDesigns(messages, parts("completed", "<main><h1>Hi</h1></main>"))
    expect(design).toMatchObject({ key: "call_1", canvas: true })
    expect(design.streaming ?? false).toBe(false)
  })
  test("other files are not designs", () => {
    expect(collectToolDesigns(messages, parts("pending", "# Title", "docs/a.md"))).toEqual([])
  })
})
