import { describe, expect, test } from "bun:test"
import { parsePartialJson } from "./partial-json"

describe("parsePartialJson", () => {
  test.each([
    ['{"a":[1,2],"b":{"c":null}}', { a: [1, 2], b: { c: null } }],
    ['{"a":"x"},', { a: "x" }],
    ["[1, 2, ", [1, 2]],
    ['{"a":12', { a: 12 }],
    ['{"a":-', {}],
    ['{"a":1.', {}],
    ['{"a":"b\\"c', { a: 'b"c' }],
    ['{"a":"\\u00e9', { a: "é" }],
    ['{"a":"x"}}', undefined],
    ["{", {}],
    ['"text', "text"],
  ])("%s", (raw, expected) => {
    expect(parsePartialJson(raw)).toEqual(expected)
  })
})
