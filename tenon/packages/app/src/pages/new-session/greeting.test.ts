import { describe, expect, test } from "bun:test"
import { greetingStep } from "./greeting"

describe("greetingStep", () => {
  test("takes the four effects in turn while the prompts cycle on their own", () => {
    expect([0, 1, 2, 3, 4, 5].map(greetingStep)).toEqual([
      { style: "rise", prompt: 1 },
      { style: "type", prompt: 2 },
      { style: "blur", prompt: 3 },
      { style: "slot", prompt: 4 },
      { style: "rise", prompt: 5 },
      { style: "type", prompt: 1 },
    ])
  })
})
