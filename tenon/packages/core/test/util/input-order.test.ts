import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { withInputOrder } from "../../src/util/input-order"

describe("withInputOrder", () => {
  test("restores input key order that struct-with-rest decoding reorders", () => {
    const Rule = Schema.Literals(["ask", "allow", "deny"])
    const Permission = Schema.StructWithRest(
      Schema.Struct({ read: Schema.optional(Rule), bash: Schema.optional(Rule) }),
      [Schema.Record(Schema.String, Rule)],
    )
    const input = { "*": "ask", bash: "allow", zeta: "deny", read: "allow" }
    const decoded = Schema.decodeUnknownSync(Permission)(input)
    expect(Object.keys(withInputOrder(input, decoded))).toEqual(["*", "bash", "zeta", "read"])
  })

  test("orders nested objects and keeps keys the input lacks", () => {
    const output = withInputOrder(
      { b: { y: 1, x: 2 }, a: [{ d: 1, c: 2 }] },
      { a: [{ c: 2, d: 1 }], b: { x: 2, y: 1 }, z: 0 },
    )
    expect(JSON.stringify(output)).toBe('{"b":{"y":1,"x":2},"a":[{"d":1,"c":2}],"z":0}')
  })

  test("keeps a __proto__ key as an own property", () => {
    const input = JSON.parse('{"__proto__": "allow", "a": "deny"}')
    const output = withInputOrder(input, { a: "deny", ...input })
    expect(Object.keys(output)).toEqual(["__proto__", "a"])
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
  })
})
