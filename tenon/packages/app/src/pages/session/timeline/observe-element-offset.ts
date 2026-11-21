import { observeElementOffset, type Virtualizer } from "@tanstack/solid-virtual"

export function observeElementOffsetReconnectAware<TScrollElement extends Element, TItemElement extends Element>(
  instance: Virtualizer<TScrollElement, TItemElement>,
  callback: (offset: number, isScrolling: boolean) => void,
) {
  let active = true
  const deliver = (offset: number, isScrolling: boolean) => {
    if (!active) return
    callback(offset, isScrolling)
  }
  const cleanupOffset = observeElementOffset(instance, deliver)
  const element = instance.scrollElement
  const targetWindow = instance.targetWindow
  const root = element?.closest("main") ?? element?.ownerDocument.body
  if (!element || !targetWindow || !root)
    return () => {
      active = false
      cleanupOffset?.()
    }

  let removed = false
  let frame: number | undefined
  const clearCheck = () => {
    if (frame === undefined) return
    targetWindow.cancelAnimationFrame(frame)
    frame = undefined
  }
  const startCheck = () => {
    clearCheck()
    const deadline = targetWindow.performance.now() + instance.options.isScrollingResetDelay
    let framesAfterDeadline = 0
    const check = (time: number) => {
      frame = undefined
      if (element.isConnected) {
        const offset = instance.options.horizontal
          ? element.scrollLeft * (instance.options.isRtl ? -1 : 1)
          : element.scrollTop
        if (instance.scrollOffset === null || Math.abs(offset - instance.scrollOffset) > 1) deliver(offset, false)
      }
      if (time >= deadline) framesAfterDeadline += 1
      if (framesAfterDeadline >= 2) return
      frame = targetWindow.requestAnimationFrame(check)
    }
    frame = targetWindow.requestAnimationFrame(check)
  }
  // While attached, only the ancestor chain up to `root` is watched (no `subtree`), so streaming mutations
  // inside the timeline, terminal or review panel don't wake this observer. Once the element is detached it
  // can come back under any parent, so the whole of `root` is watched until it does.
  const watchAncestors = () => {
    observer.disconnect()
    let ancestor: Node | null = element.parentNode
    while (ancestor) {
      observer.observe(ancestor, { childList: true })
      if (ancestor === root) break
      ancestor = ancestor.parentNode
    }
  }
  const watchRoot = () => {
    observer.disconnect()
    observer.observe(root, { childList: true, subtree: true })
  }
  const reattached = () => {
    removed = false
    startCheck()
    watchAncestors()
  }
  const observer = new targetWindow.MutationObserver((records) => {
    if (!active) return
    for (const record of records) {
      if (record.target === element || element.contains(record.target)) continue
      if (mutationNodesContainElement(record.removedNodes, element)) {
        removed = true
        clearCheck()
      }
      if (removed && element.isConnected && mutationNodesContainElement(record.addedNodes, element)) reattached()
    }
    if (!removed) return
    // Re-inserted under a parent nobody watched yet: no record reports the addition, but it's connected again.
    if (element.isConnected) reattached()
    else watchRoot()
  })
  watchAncestors()

  return () => {
    active = false
    observer.disconnect()
    clearCheck()
    cleanupOffset?.()
  }
}

export function mutationNodesContainElement(nodes: Iterable<Node>, element: Element) {
  return [...nodes].some((node) => node === element || node.contains(element))
}
