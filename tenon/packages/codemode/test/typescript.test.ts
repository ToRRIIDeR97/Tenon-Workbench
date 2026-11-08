import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const execute = (code: string) => Effect.runPromise(CodeMode.make({ tools: {} }).execute(code))

describe("TypeScript syntax stripping", () => {
  test("strips annotations, interfaces, type aliases and generics", async () => {
    const result = await execute(`
interface Point { x: number; y: number }
type Pair<T> = readonly [T, T]
const first = <T,>(pair: Pair<T>): T => pair[0]
function length(point: Point): number {
  return Math.sqrt(point.x * point.x + point.y * point.y)
}
const points: Array<Point> = [{ x: 3, y: 4 }]
return { length: length(points[0]), first: first<string>(["a", "b"]) }
`)

    expect(result.ok ? result.value : result.error).toStrictEqual({ length: 5, first: "a" })
  })

  test("supports as, satisfies, enums, non-null assertions and optional parameters", async () => {
    const result = await execute(`
enum Color { Red, Green = "green" }
const greet = (name?: string, suffix: string = "!") => "hi " + (name ?? "there") + suffix
const config = { retries: 2 } satisfies { retries: number }
const maybe: { value: number } | undefined = { value: 7 }
const raw: unknown = "41"
return {
  red: Color.Red,
  green: Color.Green,
  greeting: greet(),
  named: greet("Ada", "?"),
  retries: config.retries,
  value: maybe!.value,
  parsed: Number(raw as string) + 1,
}
`)

    expect(result.ok ? result.value : result.error).toStrictEqual({
      red: 0,
      green: "green",
      greeting: "hi there!",
      named: "hi Ada?",
      retries: 2,
      value: 7,
      parsed: 42,
    })
  })

  test("reports syntax errors as ParseError at the position in the submitted code", async () => {
    const result = await execute("const a: number = 1\n  const b = ;\nreturn a")

    expect(result.ok ? undefined : result.error).toStrictEqual({
      kind: "ParseError",
      message: "Failed to parse TypeScript: Unexpected token (line 2, col 13)",
      location: { line: 2, column: 13 },
    })
  })

  test("reports unterminated code at the end of the submitted code", async () => {
    const result = await execute("const a = 1\nreturn (a +")

    expect(result.ok ? undefined : result.error).toStrictEqual({
      kind: "ParseError",
      message: "Failed to parse TypeScript: Unexpected token (line 2, col 12)",
      location: { line: 2, column: 12 },
    })
  })

  test("keeps runtime error locations in the submitted code's coordinates", async () => {
    const result = await execute("const x: number = 1\n    missing.call(x as number)")

    expect(result.ok ? undefined : result.error).toStrictEqual({
      kind: "ExecutionFailure",
      message: "Unknown identifier 'missing'. (line 2, col 5)",
      location: { line: 2, column: 5 },
    })
  })
})
