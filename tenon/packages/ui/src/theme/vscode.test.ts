import { describe, expect, test } from "bun:test"
import { hex, importedThemeId, parseJsonc, vscodeToDesktopTheme } from "./vscode"

const file = `{
  // One Dark Pro, cut down
  "name": "One Dark Pro",
  "type": "dark",
  "colors": {
    "editor.background": "#282c34",
    "editor.foreground": "#abb2bfcc",
    "button.background": "#404754",
    "terminal.ansiGreen": "#8cc265",
    "terminal.ansiRed": "#e05561",
  },
  "tokenColors": [
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#7f848e" } },
    { "scope": "keyword, storage.type", "settings": { "foreground": "#c678dd" } },
    { "scope": "string", "settings": { "foreground": "#98c379" } },
  ],
}`

describe("VS Code themes", () => {
  test("reads JSON with comments and trailing commas", () => {
    expect((parseJsonc(file) as { name: string }).name).toBe("One Dark Pro")
    expect(parseJsonc('{ "url": "http://x//y" }')).toEqual({ url: "http://x//y" })
  })

  test("normalises colours and drops alpha", () => {
    expect(hex("#ABCDEF80")).toBe("#abcdef")
    expect(hex("#abc")).toBe("#aabbcc")
    expect(hex("red")).toBeUndefined()
  })

  test("maps editor, button and terminal colours to the palette and token colours to syntax", () => {
    const theme = vscodeToDesktopTheme(parseJsonc(file), "vscode-one-dark-pro")!
    expect(theme.name).toBe("One Dark Pro")
    expect(theme.dark.palette).toMatchObject({
      neutral: "#282c34",
      ink: "#abb2bf",
      primary: "#404754",
      success: "#8cc265",
      error: "#e05561",
    })
    expect(theme.dark.overrides).toEqual({
      "syntax-comment": "#7f848e",
      "syntax-keyword": "#c678dd",
      "syntax-string": "#98c379",
    })
  })

  test("a file without editor colours is refused, and ids never clash with built-ins", () => {
    expect(vscodeToDesktopTheme({ colors: {} }, "x")).toBeUndefined()
    expect(importedThemeId("One Dark Pro.json")).toBe("vscode-one-dark-pro")
  })
})
