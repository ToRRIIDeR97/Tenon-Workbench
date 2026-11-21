// #328: what the live caption doesn't tell you on its own — which language dictation runs with, and whether the
// final transcript (one pass over the whole recording) came out different from the words you watched.

/** The spoken language's name in the app's language, or undefined when the model detects it per recording. */
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

/**
 * Words the final transcript changed from the caption: replaced, added and dropped words count once each; case and
 * punctuation don't count. Nothing shown means nothing to compare.
 */
export function captionChanges(caption: string, final: string) {
  const before = words(caption)
  if (before.length === 0) return 0
  const after = words(final)
  // Word-level edit distance, one row at a time.
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

/**
 * Swaps `inserted`, when it is still the text right before the caret, for `replacement`, through the editor's own
 * undo stack where the browser has one. False, and nothing changed, once the user typed or moved on.
 */
export function replaceBeforeCaret(inserted: string, replacement: string) {
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
