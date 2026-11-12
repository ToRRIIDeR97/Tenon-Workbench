import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// PR2 of the UI/UX review (implementations/uiux-pr2-size-scale): one ruler for control sizes. These read the
// source; the live verification measures the rendered heights.
const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")

describe("size tokens", () => {
  // AC-1: the scale is three control heights, defined once.
  test("theme defines the control heights 28/36/44", () => {
    const theme = read("ui/src/v2/styles/theme.css")
    expect(theme).toMatch(/--v2-control-sm:\s*28px/)
    expect(theme).toMatch(/--v2-control-md:\s*36px/)
    expect(theme).toMatch(/--v2-control-lg:\s*44px/)
  })

  // AC-2: a large text field is the medium control height, like large buttons and the Settings search.
  test("large text field uses the medium control height", () => {
    const input = read("ui/src/v2/components/text-input-v2.css")
    const block = input.slice(input.indexOf('[data-component="text-input-v2"][data-appearance="large"] {'))
    expect(block.slice(0, block.indexOf("}"))).toMatch(/height:\s*var\(--v2-control-md\)/)
    const button = read("ui/src/v2/components/button-v2.css")
    expect(button).toMatch(/\[data-size="large"\] \{\s*height:\s*var\(--v2-control-md\)/)
  })
})

describe("thread composer", () => {
  // AC-3: attach, mode and model pills, and send share one 32px row height.
  test("attach and send are 32px like the pills", () => {
    const prompt = read("session-ui/src/v2/components/prompt-input/index.tsx")
    const attach = prompt.slice(prompt.indexOf('data-action="prompt-attach"'))
    expect(attach.slice(0, attach.indexOf("/>"))).toMatch(/class="[^"]*!size-8/)
    const send = prompt.slice(prompt.indexOf('data-action="prompt-submit"'))
    const cls = send.slice(send.indexOf('class="'), send.indexOf('"', send.indexOf('class="') + 7))
    expect(cls).toContain("size-8")
    expect(cls).not.toContain("size-9")
  })
})

describe("forms", () => {
  // AC-4: the Skills search uses the shared Settings search field (36px pill).
  test("Skills search sits in the Settings search wrapper", () => {
    const skills = read("app/src/components/settings-v2/skills.tsx")
    expect(skills).toMatch(/<div class="settings-v2-tab-search">\s*<TextInputV2\s+type="search"/)
  })

  // AC-5: the create-project fields share one width and the single-line fields one height.
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
  // AC-6: bold reads as bold against 450 body text.
  test("strong is 600", () => {
    // Line-ending agnostic: the file is checked out with CRLF on Windows.
    expect(read("session-ui/src/components/markdown.css")).toMatch(/strong,\s*b\s*\{[^}]*font-weight:\s*600/)
  })
})
