const DIALOGS = '[role="dialog"], [data-component="dialog-stack"] [data-expanded]'

export function browserCovered(root: ParentNode) {
  return [...root.querySelectorAll(DIALOGS)].some((dialog) => !dialog.closest("[inert]"))
}

export function watchBrowserCover(root: Document, changed: () => void) {
  const observer = new MutationObserver(changed)
  observer.observe(root.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["inert", "data-expanded"],
  })
  return () => observer.disconnect()
}
