import { designDocument } from "./design-fence"

/**
 * Live drawing of a canvas design while its fence (or `write` call) still streams.
 *
 * The parent loads `liveDesignDocument()` once into the usual design frame (same sandbox and CSP) and
 * posts `{ type: DESIGN_FRAME_MESSAGE, markup }` frames; the bootstrap morphs each frame into the body,
 * so already drawn nodes stay put instead of the frame reloading. A design's own scripts never run while
 * it streams: the frame's CSP lets only scripts with a per-document nonce run (the WebRTC guard and the
 * bootstrap), so inline handlers and javascript: URLs are blocked however they are spelled. As defence in
 * depth the parent sends `partialDesignMarkup`, and the bootstrap drops scripts, nested frames, SVG
 * animations, event handler attributes and javascript: URLs. Once the design is done the parent swaps in
 * `designDocument(source)`.
 */

export const DESIGN_FRAME_MESSAGE = "tenon:design-frame"

const script = /<script\b[\s\S]*?(?:<\/script\s*>|$)/gi
const hidden =
  /<(style|script|title)\b[\s\S]*?(?:<\/\1\s*>|$)|<!--[\s\S]*?(?:-->|$)|<!doctype[^>]*>|<\/?(?:html|head|body|meta|link)\b[^>]*>/gi

/** Half-written markup made safe to draw: no scripts, no unterminated comment, no unfinished last tag. */
export function partialDesignMarkup(source: string) {
  const text = source.replace(script, "")
  // The first <!-- with no --> after it opens a comment that runs to the end; it is the first one after the last -->.
  const close = text.lastIndexOf("-->")
  const comment = text.indexOf("<!--", close < 0 ? 0 : close + 3)
  const open = comment >= 0 ? text.slice(0, comment) : text
  const tag = open.lastIndexOf("<")
  return tag >= 0 && !open.includes(">", tag) ? open.slice(0, tag) : open
}

/** Whether the markup so far draws anything: an element or text beyond styles, metadata and the page skeleton. */
export function hasVisibleMarkup(source: string) {
  return /\S/.test(partialDesignMarkup(source).replace(hidden, ""))
}

/**
 * Makes `to`'s children match `from`'s, keeping every node that has the same type and name at the same
 * place. Returns the elements it inserted, in document order.
 *
 * It runs inside the design frame too (see `liveDesignDocument`), so it must stay self-contained:
 * no imports, no helpers and no named inner functions.
 */
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

/**
 * The srcdoc of a live design frame: `designDocument` (CSP first, WebRTC guard) with a fresh script
 * nonce, and a bootstrap that morphs frames from the parent into the body. Messages from anywhere else,
 * or of another shape, are ignored. The bootstrap loads nothing.
 *
 * Each frame fades its new elements in (none under reduced motion) and outlines the element being
 * written: the deepest last element. The frame can't read the app's tokens, so the caller passes their
 * values (`duration` in ms, `easing`, `accent` colour); the defaults only stand in for them in tests.
 */
export function liveDesignDocument(motion: { duration?: number; easing?: string; accent?: string } = {}) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return designDocument(
    [
      `<script nonce="${nonce}">(()=>{`,
      // Bundles built with esbuild's keepNames wrap named functions in __name(); make it a no-op here.
      "const __name=(value)=>value;",
      `const morph=(${String(morphChildren)});`,
      `const type=${JSON.stringify(DESIGN_FRAME_MESSAGE)};`,
      `const duration=${JSON.stringify(Number.isFinite(motion.duration) ? motion.duration : 300)};`,
      `const easing=${JSON.stringify(motion.easing || "ease-out")};`,
      `const accent=${JSON.stringify(motion.accent || "Highlight")};`,
      "const still=matchMedia('(prefers-reduced-motion: reduce)');",
      "const hidden=new Set(['style','script','title','template','link','meta']);",
      "const outline=document.createElement('style');",
      "outline.textContent='[data-tenon-writing]{outline:2px solid color-mix(in srgb,'+accent+' 55%,transparent);outline-offset:2px}';",
      "document.head.append(outline);",
      // The element being written: from the body down through each last child that draws something.
      "const writing=()=>{let node=document.body;while(node){let child=node.lastElementChild;",
      "while(child&&hidden.has(child.localName.toLowerCase()))child=child.previousElementSibling;",
      "if(!child)return node===document.body?undefined:node;node=child}};",
      "addEventListener('message',(event)=>{",
      "if(event.source!==parent)return;",
      "const data=event.data;",
      "if(!data||typeof data!=='object'||data.type!==type||typeof data.markup!=='string')return;",
      "const template=document.createElement('template');",
      "template.innerHTML=data.markup;",
      // SVG animations can set an href to javascript: (`values="0;javascript:…"`), so they go too.
      "const blocked=new Set(['script','iframe','frame','object','embed','meta','base','animate','set','animatemotion','animatetransform']);",
      "template.content.querySelectorAll('*').forEach((node)=>{",
      "if(blocked.has(node.localName.toLowerCase())){node.remove();return}",
      "Array.from(node.attributes).forEach((attribute)=>{",
      // URL parsers drop control characters and whitespace (java&#9;script:), so the scheme is tested without them.
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
