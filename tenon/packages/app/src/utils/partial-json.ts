import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const literal = /^(?:true|false|null)$/
const token = /[\w.+-]/
const quoteOrEscape = /["\\]/g

/**
 * The value of a JSON text cut off mid-stream, such as a tool's input while the model writes it.
 * An open string keeps what has arrived (minus a dangling escape), a key without a whole value is
 * dropped, a trailing comma is ignored and open arrays and objects are closed. Complete JSON parses as
 * `JSON.parse` does; empty or non-JSON text gives `undefined`.
 */
export function parsePartialJson(raw: string): unknown {
  const healed = heal(raw)
  if (healed === undefined) return undefined
  return Option.getOrUndefined(decode(healed))
}

/** Cuts `raw` back to the longest prefix that is whole JSON once the open containers are closed. */
function heal(raw: string) {
  // Closers of the open arrays and objects, innermost first.
  let closers = ""
  // The last point where cutting and appending that point's closers gives whole JSON.
  let safe: { end: number; closers: string } | undefined
  // The last structural character outside strings, to tell an object key from a value.
  let previous = ""
  let index = 0
  while (index < raw.length) {
    const char = raw[index]
    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      index += 1
      continue
    }
    if (char === '"') {
      const key = closers.startsWith("}") && (previous === "{" || previous === ",")
      const end = stringEnd(raw, index + 1)
      if (end.open && key) return cut(raw, safe)
      if (end.open) return raw.slice(0, end.index) + '"' + closers
      index = end.index + 1
      previous = '"'
      if (!key) safe = { end: index, closers }
      continue
    }
    if (char === "{" || char === "[") {
      closers = (char === "{" ? "}" : "]") + closers
      index += 1
      previous = char
      safe = { end: index, closers }
      continue
    }
    if (char === "}" || char === "]") {
      if (!closers.startsWith(char)) return undefined
      closers = closers.slice(1)
      index += 1
      previous = char
      safe = { end: index, closers }
      continue
    }
    if (char === "," || char === ":") {
      index += 1
      previous = char
      continue
    }
    if (!token.test(char)) return undefined
    const start = index
    while (index < raw.length && token.test(raw[index])) index += 1
    const word = raw.slice(start, index)
    // A number or literal at the very end may still grow; keep it only if it is already whole.
    if (index === raw.length) return number.test(word) || literal.test(word) ? raw + closers : cut(raw, safe)
    previous = "value"
    safe = { end: index, closers }
  }
  return cut(raw, safe)
}

function cut(raw: string, safe: { end: number; closers: string } | undefined) {
  if (!safe) return undefined
  return raw.slice(0, safe.end) + safe.closers
}

/** Where the string starting at `from` closes, or where its text should be cut when it is still open. */
function stringEnd(raw: string, from: number) {
  quoteOrEscape.lastIndex = from
  while (true) {
    const match = quoteOrEscape.exec(raw)
    if (!match) return { index: raw.length, open: true }
    if (match[0] === '"') return { index: match.index, open: false }
    // A `\` or `\uXXXX` without all its characters yet is dropped.
    const size = raw[match.index + 1] === "u" ? 6 : 2
    if (match.index + size > raw.length) return { index: match.index, open: true }
    quoteOrEscape.lastIndex = match.index + size
  }
}
