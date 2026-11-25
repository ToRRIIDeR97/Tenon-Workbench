export function elapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

type TreeNode = { parentNode: TreeNode | null; childNodes: ArrayLike<TreeNode> }

export function nodePath(root: TreeNode, node: TreeNode) {
  const path: number[] = []
  let current: TreeNode | null = node
  while (current && current !== root) {
    const parent: TreeNode | null = current.parentNode
    if (!parent) return undefined
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current))
    current = parent
  }
  return current === root ? path : undefined
}

export function nodeAt<T extends TreeNode>(root: T, path: number[]): T | undefined {
  let current: TreeNode | undefined = root
  for (const index of path) current = current?.childNodes[index]
  return current as T | undefined
}

export function ghostUpdate(shown: string, next: string) {
  if (next.startsWith(shown)) return { append: next.slice(shown.length) }
  return { replace: next }
}

export type GhostLayer = {
  write(text: string): void
  pause(): void
  settle(text: string): void
  remove(): void
}

export function ghostLayer(box: HTMLElement): GhostLayer | undefined {
  const editor = box.querySelector<HTMLElement>('[data-component="prompt-input"]')
  const field = editor ? undefined : box.querySelector<HTMLTextAreaElement>("textarea")
  const ghost = document.createElement("span")
  ghost.dataset.slot = "dictation-ghost"
  const caret = document.createElement("span")
  caret.dataset.slot = "dictation-caret"
  caret.setAttribute("aria-hidden", "true")
  let layer: HTMLElement
  let restore: () => void
  if (editor && editor.parentElement) {
    layer = editor.cloneNode(true) as HTMLElement
    layer.removeAttribute("contenteditable")
    layer.removeAttribute("role")
    layer.removeAttribute("aria-label")
    layer.setAttribute("aria-hidden", "true")
    layer.style.position = "absolute"
    layer.style.inset = "0"
    layer.style.pointerEvents = "none"
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined
    const path = range && editor.contains(range.startContainer) ? nodePath(editor, range.startContainer) : undefined
    const target = path && nodeAt(layer as Node, path)
    if (target && range && target.nodeType === Node.TEXT_NODE) {
      const after = (target as Text).splitText(Math.min(range.startOffset, (target as Text).length))
      after.before(ghost, caret)
    } else if (target && range && target.childNodes.length >= range.startOffset) {
      target.insertBefore(ghost, target.childNodes[range.startOffset] ?? null)
      ghost.after(caret)
    } else layer.append(ghost, caret)
    const placeholder = box.querySelector<HTMLElement>('[data-slot="prompt-placeholder"]')
    editor.parentElement.append(layer)
    layer.scrollTop = editor.scrollTop
    editor.style.visibility = "hidden"
    if (placeholder) placeholder.style.visibility = "hidden"
    restore = () => {
      editor.style.visibility = ""
      if (placeholder) placeholder.style.visibility = ""
    }
  } else if (field && field.parentElement) {
    const style = getComputedStyle(field)
    layer = document.createElement("div")
    layer.setAttribute("aria-hidden", "true")
    for (const name of ["font", "letterSpacing", "padding", "boxSizing", "textAlign", "direction"] as const)
      layer.style[name] = style[name]
    Object.assign(layer.style, {
      position: "absolute",
      left: `${field.offsetLeft}px`,
      top: `${field.offsetTop}px`,
      width: `${field.offsetWidth}px`,
      height: `${field.offsetHeight}px`,
      overflow: "hidden",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      pointerEvents: "none",
      color: style.color,
    })
    const start = field.selectionStart ?? field.value.length
    const end = field.selectionEnd ?? start
    layer.append(field.value.slice(0, start), ghost, caret, field.value.slice(end))
    const parent = field.parentElement
    const positioned = getComputedStyle(parent).position !== "static"
    if (!positioned) parent.style.position = "relative"
    parent.append(layer)
    layer.scrollTop = field.scrollTop
    const placeholder = field.placeholder
    field.placeholder = ""
    field.style.color = "transparent"
    restore = () => {
      field.style.color = ""
      field.placeholder = placeholder
      if (!positioned) parent.style.position = ""
    }
  } else return undefined

  let shown = ""
  const reveal = () => {
    const bottom = caret.offsetTop + caret.offsetHeight
    if (bottom > layer.scrollTop + layer.clientHeight) layer.scrollTop = bottom - layer.clientHeight
  }
  const words = (text: string) => {
    for (const word of text.split(/(?=\s)/)) {
      if (!word) continue
      const span = document.createElement("span")
      span.dataset.slot = "dictation-ghost-word"
      span.textContent = word
      ghost.append(span)
    }
  }
  return {
    write(text) {
      const before = ghost.previousSibling?.textContent ?? ""
      const spaced = text && before && !/\s$/.test(before) ? ` ${text}` : text
      const change = ghostUpdate(shown, spaced)
      if (change.replace !== undefined) {
        ghost.textContent = ""
        words(change.replace)
      } else if (change.append) words(change.append)
      shown = spaced
      reveal()
    },
    pause() {
      caret.dataset.paused = ""
    },
    settle(text) {
      caret.remove()
      const before = ghost.previousSibling?.textContent ?? ""
      ghost.textContent = text && before && !/\s$/.test(before) ? ` ${text}` : text
      ghost.dataset.settled = ""
      reveal()
    },
    remove() {
      layer.remove()
      restore()
    },
  }
}
