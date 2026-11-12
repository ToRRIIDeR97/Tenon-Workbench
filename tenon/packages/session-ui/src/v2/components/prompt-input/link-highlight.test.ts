import { describe, expect, test } from "bun:test"
import { findLinks } from "./link-highlight"

const urls = (text: string) => findLinks(text).map((link) => text.slice(link.start, link.end))

describe("findLinks", () => {
  test("finds http and https links with their positions", () => {
    const text = "see https://tenon.dev/docs and http://localhost:4445/x?y=1#z"
    expect(urls(text)).toEqual(["https://tenon.dev/docs", "http://localhost:4445/x?y=1#z"])
    expect(findLinks(text)[0]).toEqual({ start: 4, end: 26, url: "https://tenon.dev/docs" })
  })

  test("drops trailing punctuation and unmatched brackets", () => {
    expect(urls("Read https://a.com/b.")).toEqual(["https://a.com/b"])
    expect(urls("(see https://a.com/b), then")).toEqual(["https://a.com/b"])
    expect(urls("[link](https://a.com/b)")).toEqual(["https://a.com/b"])
    expect(urls("https://en.wikipedia.org/wiki/Tenon_(joint)!")).toEqual([
      "https://en.wikipedia.org/wiki/Tenon_(joint)",
    ])
  })

  test("opens www. hosts over https", () => {
    expect(findLinks("go to www.example.com now")[0]?.url).toBe("https://www.example.com")
  })

  test("ignores bare schemes and plain text", () => {
    expect(findLinks("https:// and www. and example.com")).toEqual([])
  })
})
