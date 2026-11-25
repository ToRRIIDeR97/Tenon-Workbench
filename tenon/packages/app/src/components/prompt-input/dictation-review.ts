export function dictationLanguageName(code: string | undefined, locale: string) {
  if (!code) return undefined
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

const words = (text: string) =>
  text
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""))
    .filter(Boolean)

export function captionChanges(caption: string, final: string) {
  const before = words(caption)
  if (before.length === 0) return 0
  const after = words(final)
  let previous = Array.from({ length: after.length + 1 }, (_, index) => index)
  for (let i = 1; i <= before.length; i++) {
    const row = [i]
    for (let j = 1; j <= after.length; j++) {
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (before[i - 1] === after[j - 1] ? 0 : 1))
    }
    previous = row
  }
  return previous[after.length]!
}

export function replaceBeforeCaret(inserted: string, replacement: string) {
  const field = document.activeElement
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    const end = field.selectionStart ?? 0
    if (
      field.selectionEnd !== end ||
      end < inserted.length ||
      field.value.slice(end - inserted.length, end) !== inserted
    )
      return false
    field.setSelectionRange(end - inserted.length, end)
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, replacement))
      return true
    field.setRangeText(replacement, end - inserted.length, end, "end")
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: replacement }))
    return true
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
  const node = selection.anchorNode
  if (node?.nodeType !== Node.TEXT_NODE) return false
  const offset = selection.anchorOffset
  const text = node.textContent ?? ""
  if (offset < inserted.length || text.slice(offset - inserted.length, offset) !== inserted) return false
  const range = document.createRange()
  range.setStart(node, offset - inserted.length)
  range.setEnd(node, offset)
  selection.removeAllRanges()
  selection.addRange(range)
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, replacement)) return true
  range.deleteContents()
  const added = document.createTextNode(replacement)
  range.insertNode(added)
  range.setStartAfter(added)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  const editable = (node.parentElement?.closest("[contenteditable]") as HTMLElement | null) ?? node.parentElement
  editable?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: replacement }))
  return true
}
