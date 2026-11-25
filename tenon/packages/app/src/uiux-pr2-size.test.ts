import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")

describe("size tokens", () => {
  test("theme defines the control heights 28/36/44", () => {
    const theme = read("ui/src/v2/styles/theme.css")
    expect(theme).toMatch(/--v2-control-sm:\s*28px/)
    expect(theme).toMatch(/--v2-control-md:\s*36px/)
    expect(theme).toMatch(/--v2-control-lg:\s*44px/)
  })

  test("large text field uses the medium control height", () => {
    const input = read("ui/src/v2/components/text-input-v2.css")
    const block = input.slice(input.indexOf('[data-component="text-input-v2"][data-appearance="large"] {'))
    expect(block.slice(0, block.indexOf("}"))).toMatch(/height:\s*var\(--v2-control-md\)/)
    const button = read("ui/src/v2/components/button-v2.css")
    expect(button).toMatch(/\[data-size="large"\] \{\s*height:\s*var\(--v2-control-md\)/)
  })
})

describe("thread composer", () => {
  test("attach and send are 30px like the other controls", () => {
    const prompt = read("session-ui/src/v2/components/prompt-input/index.tsx")
    const attach = prompt.slice(prompt.indexOf('data-action="prompt-attach"'))
    expect(attach.slice(0, attach.indexOf("/>"))).toMatch(/class="[^"]*!size-\[30px\]/)
    const send = prompt.slice(prompt.indexOf('data-action="prompt-submit"'))
    const cls = send.slice(send.indexOf('class="'), send.indexOf('"', send.indexOf('class="') + 7))
    expect(cls).toContain("size-[30px]")
    expect(cls).not.toContain("size-8")
    const row = read("session-ui/src/v2/components/prompt-input/responsive-controls.css")
    expect(row).toMatch(/\[data-slot="prompt-input-controls-row"\] \{\s*& button \{\s*height: 30px/)
  })
})

describe("forms", () => {
  test("Skills search sits in the Settings search wrapper", () => {
    const skills = read("app/src/components/settings-v2/skills.tsx")
    expect(skills).toMatch(/<div class="settings-v2-tab-search">\s*<TextInputV2\s+type="search"/)
  })

  test("create-project fields are full width and 36px", () => {
    const details = read("app/src/features/second-brain/project-details.tsx")
    const form = details.slice(
      details.indexOf('id="project-create-title"'),
      details.indexOf('id="project-location"') + 400,
    )
    expect(form).toMatch(/id="project-name"[\s\S]*?class="!w-full"/)
    expect(form).toMatch(/id="project-outcome"[\s\S]*?class="!w-full"/)
    expect(form).toMatch(/id="project-location"[\s\S]*?class="!h-\[var\(--v2-control-md\)\] !w-full"/)
  })
})

describe("markdown", () => {
  test("strong is 600", () => {
    expect(read("session-ui/src/components/markdown.css")).toMatch(/strong,\s*b\s*\{[^}]*font-weight:\s*600/)
  })
})
