import { describe, expect, test } from "bun:test"
import { MAX_VIEW_ITEMS, mountViewWindows, viewItems, viewKind } from "./view-window"

describe("view blocks", () => {
  test("each line is a path or https URL, typed by extension", () => {
    expect(
      viewItems("art/rifle.glb\n\n# notes\n`audio/shot.wav`\nhttps://example.com/ref.png?v=2\nC:\\art\\arms.PNG"),
    ).toEqual([
      { src: "art/rifle.glb", name: "rifle.glb", kind: "model", remote: false },
      { src: "audio/shot.wav", name: "shot.wav", kind: "audio", remote: false },
      { src: "https://example.com/ref.png?v=2", name: "ref.png", kind: "image", remote: true },
      { src: "C:\\art\\arms.PNG", name: "arms.PNG", kind: "image", remote: false },
    ])
  })

  test("other URL schemes are dropped and the list is capped", () => {
    expect(
      viewItems("javascript:alert(1)\nfile:///etc/passwd\nhttp://example.com/a.png\ndata:image/png;base64,AA"),
    ).toEqual([])
    expect(viewItems(Array.from({ length: 20 }, (_, index) => `f${index}.png`).join("\n"))).toHaveLength(MAX_VIEW_ITEMS)
  })

  test("kinds cover media, documents and models, else a plain file", () => {
    expect(
      ["a.mp4", "a.mp3", "a.pdf", "a.gltf", "a.md", "a.csv", "a.json", "a.xlsx", "a.docx", "a.zip"].map(viewKind),
    ).toEqual(["video", "audio", "pdf", "model", "markdown", "csv", "json", "sheet", "doc", "file"])
  })
})

describe.skipIf(typeof document === "undefined")("view windows", () => {
  test("the Pin button follows a list that loads after the window is drawn, and stops when replaced", () => {
    const labels = { open: "Open", pin: "Pin", pinned: "Pinned", unsupported: "No viewer" }
    let pinned = false
    let change: ((pinned: boolean) => void) | undefined
    let watching = 0
    const root = document.createElement("div")
    root.innerHTML =
      '<div data-component="markdown-code"><pre><code class="language-view">art/rifle.glb</code></pre></div>'
    mountViewWindows(root, labels, {
      render: () => {},
      pin: () => (pinned = !pinned),
      pinned: () => pinned,
      watchPinned: (_item, next) => {
        watching++
        change = next
        return () => watching--
      },
    })
    const pin = () => root.querySelector<HTMLButtonElement>('[data-action="view-pin"]')!
    expect([pin().textContent, pin().getAttribute("aria-pressed")]).toEqual(["Pin", "false"])
    pinned = true
    change?.(true)
    expect([pin().textContent, pin().getAttribute("aria-pressed")]).toEqual(["Pinned", "true"])
    root.querySelector("code")!.textContent = "art/other.glb"
    mountViewWindows(root, labels, { render: () => {} })
    expect(watching).toBe(0)
  })
})
