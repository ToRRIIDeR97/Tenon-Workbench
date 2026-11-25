import { designDocument } from "./design-fence"

export const DESIGN_FRAME_MESSAGE = "tenon:design-frame"

const script = /<script\b[\s\S]*?(?:<\/script\s*>|$)/gi
const cssValue = /^[\w\s#(),.%/+-]{1,200}$/
const hidden =
  /<(style|script|title)\b[\s\S]*?(?:<\/\1\s*>|$)|<!--[\s\S]*?(?:-->|$)|<!doctype[^>]*>|<\/?(?:html|head|body|meta|link)\b[^>]*>/gi

export function partialDesignMarkup(source: string) {
  const text = source.replace(script, "")
  const close = text.lastIndexOf("-->")
  const comment = text.indexOf("<!--", close < 0 ? 0 : close + 3)
  const open = comment >= 0 ? text.slice(0, comment) : text
  const tag = open.lastIndexOf("<")
  return tag >= 0 && !open.includes(">", tag) ? open.slice(0, tag) : open
}

export function hasVisibleMarkup(source: string) {
  return /\S/.test(partialDesignMarkup(source).replace(hidden, ""))
}

export function morphChildren(to: Node, from: Node): Element[] {
  const next = Array.from(from.childNodes)
  Array.from(to.childNodes)
    .slice(next.length)
    .forEach((node) => node.parentNode?.removeChild(node))
  return next.flatMap((node, index): Element[] => {
    const current = to.childNodes[index]
    if (current && current.nodeType === node.nodeType && current.nodeName === node.nodeName) {
      if (!(current instanceof Element && node instanceof Element)) {
        if (current.nodeValue !== node.nodeValue) current.nodeValue = node.nodeValue
        return []
      }
      Array.from(current.attributes)
        .filter((attribute) => !node.hasAttribute(attribute.name))
        .forEach((attribute) => current.removeAttribute(attribute.name))
      Array.from(node.attributes)
        .filter((attribute) => current.getAttribute(attribute.name) !== attribute.value)
        .forEach((attribute) => current.setAttribute(attribute.name, attribute.value))
      return morphChildren(current, node)
    }
    const copy = (to.ownerDocument ?? document).importNode(node, true)
    if (current) to.replaceChild(copy, current)
    if (!current) to.appendChild(copy)
    return copy instanceof Element ? [copy] : []
  })
}

export function liveDesignDocument(motion: { duration?: number; easing?: string; accent?: string } = {}) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  const embed = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c")
  const css = (value: string | undefined, fallback: string) => (value && cssValue.test(value) ? value : fallback)
  return designDocument(
    [
      `<script nonce="${nonce}">(()=>{`,
      "const __name=(value)=>value;",
      `const morph=(${String(morphChildren)});`,
      `const type=${embed(DESIGN_FRAME_MESSAGE)};`,
      `const duration=${embed(Number.isFinite(motion.duration) ? motion.duration : 300)};`,
      `const easing=${embed(css(motion.easing, "ease-out"))};`,
      `const accent=${embed(css(motion.accent, "Highlight"))};`,
      "const still=matchMedia('(prefers-reduced-motion: reduce)');",
      "const hidden=new Set(['style','script','title','template','link','meta']);",
      "const outline=document.createElement('style');",
      "outline.textContent='[data-tenon-writing]{outline:2px solid color-mix(in srgb,'+accent+' 55%,transparent);outline-offset:2px}';",
      "document.head.append(outline);",
      "const writing=()=>{let node=document.body;while(node){let child=node.lastElementChild;",
      "while(child&&hidden.has(child.localName.toLowerCase()))child=child.previousElementSibling;",
      "if(!child)return node===document.body?undefined:node;node=child}};",
      "addEventListener('message',(event)=>{",
      "if(event.source!==parent)return;",
      "const data=event.data;",
      "if(!data||typeof data!=='object'||data.type!==type||typeof data.markup!=='string')return;",
      "const template=document.createElement('template');",
      "template.innerHTML=data.markup;",
      "const blocked=new Set(['script','iframe','frame','object','embed','meta','base','animate','set','animatemotion','animatetransform']);",
      "template.content.querySelectorAll('*').forEach((node)=>{",
      "if(blocked.has(node.localName.toLowerCase())){node.remove();return}",
      "Array.from(node.attributes).forEach((attribute)=>{",
      "const value=attribute.value.replace(/[\\u0000-\\u0020\\u007f-\\u009f\\s]/g,'');",
      "if(/^on/i.test(attribute.name)||/^javascript:/i.test(value))node.removeAttribute(attribute.name)})});",
      "const added=morph(document.body,template.content);",
      "if(!still.matches)added.forEach((node)=>node.animate?.([{opacity:0},{opacity:1}],{duration,easing}));",
      "document.querySelectorAll('[data-tenon-writing]').forEach((node)=>node.removeAttribute('data-tenon-writing'));",
      "writing()?.setAttribute('data-tenon-writing','')",
      "})})()</script>",
    ].join(""),
    { nonce },
  )
}
