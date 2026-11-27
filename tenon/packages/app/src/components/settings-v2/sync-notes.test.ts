import { expect, test } from "bun:test"
import { dict } from "@/i18n/en"

test("the sync folder says it never needs sharing and the phone says to revoke it on the computer", () => {
  expect(dict["secondBrain.settings.sync.folder.description"]).toContain("{{folder}}")
  expect(dict["secondBrain.settings.sync.folder.description"]).toMatch(/never needs sharing/)
  expect(dict["secondBrain.companion.settings.description"]).toContain("{{name}}")
  expect(dict["secondBrain.companion.settings.description"]).toMatch(/revoke the phone/)
})
