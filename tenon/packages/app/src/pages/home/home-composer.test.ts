import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = join(import.meta.dir, "..", "..")
const read = (path: string) => readFileSync(join(src, path), "utf8")

describe("AC-3 Home uses the thread composer", () => {
  test("Home renders HomeComposer instead of ComposerBox", () => {
    const home = read("pages/brain-home.tsx")
    expect(home).toContain("<HomeComposer")
    expect(home).not.toContain("<ComposerBox")
    expect(home).not.toContain("createComposerHarness")
  })

  test("HomeComposer renders PromptInputV2Composer with the draft's harness controller", () => {
    const composer = read("pages/home/home-composer.tsx")
    expect(composer).toContain("<PromptInputV2Composer")
    expect(composer).toContain("createNewSessionDraftController")
  })
})

describe("AC-1 no suspended harness check", () => {
  test("the Command Centre's model pill has no Suspense fallback", () => {
    const pill = read("components/prompt-input/composer-harness.tsx")
    expect(pill).not.toContain("<Suspense")
    expect(pill).not.toContain('"harness.checking"')
  })
})
