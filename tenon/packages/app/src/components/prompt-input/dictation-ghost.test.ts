import { describe, expect, test } from "bun:test"
import { elapsedLabel, ghostLayer, ghostUpdate, nodeAt, nodePath } from "./dictation-ghost"

type Fake = { name: string; parentNode: Fake | null; childNodes: Fake[] }

function tree(name: string, ...children: Fake[]): Fake {
  const node: Fake = { name, parentNode: null, childNodes: children }
  for (const child of children) child.parentNode = node
  return node
}

describe("dictation writes in place", () => {
  test("the capsule's timer reads m:ss", () => {
    expect(elapsedLabel(0)).toBe("0:00")
    expect(elapsedLabel(4_900)).toBe("0:04")
    expect(elapsedLabel(65_000)).toBe("1:05")
    expect(elapsedLabel(-20)).toBe("0:00")
  })

  test("the caret's place in the editor is found again in its copy", () => {
    const text = tree("text")
    const editor = tree("editor", tree("a"), tree("p", tree("b"), text))
    const path = nodePath(editor, text)
    expect(path).toEqual([1, 1])
    const copy = tree("copy", tree("a2"), tree("p2", tree("b2"), tree("text2")))
    expect(nodeAt(copy, path!)?.name).toBe("text2")
  })

  test("a caret outside the editor, or a copy that differs, gives no place", () => {
    const outside = tree("outside")
    const editor = tree("editor", tree("a"))
    tree("page", editor, outside)
    expect(nodePath(editor, outside)).toBeUndefined()
    expect(nodeAt(editor, [3])).toBeUndefined()
  })

  test("a growing caption only appends; changed earlier words rewrite the ghost", () => {
    expect(ghostUpdate("Can you", "Can you move")).toEqual({ append: " move" })
    expect(ghostUpdate("Can you", "Could you move")).toEqual({ replace: "Could you move" })
  })
})

describe("the ghost layer", () => {
  const box = (inner: string) => {
    const element = document.createElement("div")
    element.innerHTML = inner
    document.body.append(element)
    return element
  }

  test("the thread editor is copied with the words at the caret, and left as it was", () => {
    const root = box(
      `<div><div data-component="prompt-input" contenteditable="true">Quick note: rest</div></div><div data-slot="prompt-placeholder"></div>`,
    )
    const editor = root.querySelector<HTMLElement>('[data-component="prompt-input"]')!
    const range = document.createRange()
    range.setStart(editor.firstChild!, "Quick note:".length)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)

    const layer = ghostLayer(root)!
    layer.write("Can you")
    layer.write("Can you move it")
    const copy = root.querySelector<HTMLElement>('[aria-hidden="true"]')!
    expect(copy.getAttribute("contenteditable")).toBeNull()
    // Spaced from the text before the caret, before the text after it.
    expect(copy.textContent).toBe("Quick note: Can you move it rest")
    expect(copy.querySelectorAll('[data-slot="dictation-ghost-word"]').length).toBe(4)
    expect(editor.style.visibility).toBe("hidden")
    expect(editor.textContent).toBe("Quick note: rest")

    layer.settle("Can you move it.")
    expect(copy.querySelector('[data-slot="dictation-ghost"]')!.hasAttribute("data-settled")).toBe(true)
    expect(copy.querySelector('[data-slot="dictation-caret"]')).toBeNull()
    layer.remove()
    expect(root.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(editor.style.visibility).toBe("")
    root.remove()
  })

  test("a textarea composer gets a mirror, its text and placeholder hidden until the end", () => {
    const root = box(`<form><textarea placeholder="Ask anything"></textarea></form>`)
    const field = root.querySelector("textarea")!
    field.value = "Note"
    field.setSelectionRange(4, 4)

    const layer = ghostLayer(root)!
    layer.write("from the call")
    const mirror = root.querySelector<HTMLElement>('[aria-hidden="true"]')!
    expect(mirror.textContent).toBe("Note from the call")
    expect(field.style.color).toBe("transparent")
    expect(field.placeholder).toBe("")
    expect(field.value).toBe("Note")

    layer.remove()
    expect(root.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(field.style.color).toBe("")
    expect(field.placeholder).toBe("Ask anything")
    root.remove()
  })
})
