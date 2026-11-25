export function isLocalMediaSource(value: string) {
  return /^\s*(?:data|blob):/i.test(value)
}

const mediaAttributes = ["src", "srcset", "poster"] as const

export function stripRemoteMedia(node: Element) {
  node.removeAttribute("background")
  if (!["IMG", "SOURCE", "VIDEO", "AUDIO", "INPUT", "TRACK"].includes(node.tagName)) return
  for (const attribute of mediaAttributes) {
    const value = node.getAttribute(attribute)
    if (value !== null && (attribute === "srcset" || !isLocalMediaSource(value))) node.removeAttribute(attribute)
  }
}

type StyledElement = {
  readonly style?: {
    readonly length: number
    readonly [index: number]: string
    getPropertyValue(property: string): string
    removeProperty(property: string): string
  }
  hasAttribute(name: string): boolean
  removeAttribute(name: string): void
}

const allowedStyle = /^(?:color|background-color|font-style|font-weight|text-decoration(?:-[a-z]+)?|--shiki-[\w-]+)$/

export function restrictStyle(node: StyledElement) {
  const style = node.style
  if (!style || !node.hasAttribute("style")) return
  const properties = Array.from({ length: style.length }, (_, index) => style[index])
  for (const property of properties) {
    if (!allowedStyle.test(property) || /url\(/i.test(style.getPropertyValue(property))) style.removeProperty(property)
  }
  if (!style.length) node.removeAttribute("style")
}
