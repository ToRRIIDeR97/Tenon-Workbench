import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const literal = /^(?:true|false|null)$/
const token = /[\w.+-]/
const quoteOrEscape = /["\\]/g

export function parsePartialJson(raw: string): unknown {
  const healed = heal(raw)
  if (healed === undefined) return undefined
  return Option.getOrUndefined(decode(healed))
}

function heal(raw: string) {
  let closers = ""
  let safe: { end: number; closers: string } | undefined
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

function stringEnd(raw: string, from: number) {
  quoteOrEscape.lastIndex = from
  while (true) {
    const match = quoteOrEscape.exec(raw)
    if (!match) return { index: raw.length, open: true }
    if (match[0] === '"') return { index: match.index, open: false }
    const size = raw[match.index + 1] === "u" ? 6 : 2
    if (match.index + size > raw.length) return { index: match.index, open: true }
    quoteOrEscape.lastIndex = match.index + size
  }
}
