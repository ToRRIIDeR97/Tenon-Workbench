import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { meterAttributes } from "./meter"

describe("Meter", () => {
  test("a labelled meter is announced with its rounded value", () => {
    expect(meterAttributes({ value: 24.6, label: "Harness weekly" })).toEqual({
      role: "meter",
      hidden: undefined,
      label: "Harness weekly",
      min: 0,
      max: 100,
      now: 25,
    })
  })

  test("a meter without a label is decorative and adds nothing to its row's name", () => {
    expect(meterAttributes({ value: 25 })).toEqual({
      role: undefined,
      hidden: true,
      label: undefined,
      min: undefined,
      max: undefined,
      now: undefined,
    })
  })

  test("Home's project row keeps its bar out of the button's name, which already says the percentage", () => {
    const home = readFileSync(path.resolve(import.meta.dir, "../pages/brain-home.tsx"), "utf8")
    const row = home.slice(home.indexOf("{project.name}"), home.indexOf("{project.progressPercent}%"))
    expect(row).toMatch(/<Meter class="w-16 shrink-0" value=\{project\.progressPercent\} \/>/)
  })
})
