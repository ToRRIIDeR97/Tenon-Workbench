import type { DesktopTheme, HexColor, ThemePaletteColors } from "./types"

type TokenColor = { scope?: string | string[]; settings?: { foreground?: string } }
type VscodeTheme = { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: TokenColor[] }

/** VS Code theme files are JSON with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, string?: string) => string ?? "")
    .replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(stripped)
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as `#rrggbb`; anything else is undefined. */
export function hex(value: string | undefined): HexColor | undefined {
  const match = value?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!match) return undefined
  const digits = match[1]
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits.slice(0, 6)
  return `#${full.toLowerCase()}`
}

// Tenon syntax keys and the TextMate scopes that colour them, most specific first.
const SYNTAX: Record<string, string[]> = {
  "syntax-comment": ["comment"],
  "syntax-keyword": ["keyword", "storage.type", "storage"],
  "syntax-string": ["string"],
  "syntax-primitive": ["constant.numeric", "constant.language"],
  "syntax-variable": ["variable", "variable.other"],
  "syntax-property": ["variable.other.property", "support.type.property-name", "meta.property-name"],
  "syntax-type": ["entity.name.type", "support.type", "entity.name.class"],
  "syntax-constant": ["constant", "variable.other.constant"],
  "syntax-operator": ["keyword.operator"],
  "syntax-punctuation": ["punctuation"],
}

/**
 * A VS Code colour theme as a Tenon theme. The editor's background and text, its button colour and the terminal's
 * ANSI colours fill Tenon's palette; `tokenColors` fill the syntax colours. Tenon has one variant per mode, so the
 * theme's own mode gets the colours and the other mode keeps them too (a dark theme stays dark in light mode).
 * Returns undefined when the file has no editor background and foreground.
 */
export function vscodeToDesktopTheme(input: unknown, id: string): DesktopTheme | undefined {
  if (!input || typeof input !== "object") return undefined
  const theme = input as VscodeTheme
  const colors = theme.colors ?? {}
  const pick = (...keys: string[]) => keys.map((key) => hex(colors[key])).find(Boolean)
  const neutral = pick("editor.background", "sideBar.background")
  const ink = pick("editor.foreground", "foreground")
  if (!neutral || !ink) return undefined
  const primary = pick("button.background", "focusBorder", "textLink.foreground", "activityBarBadge.background") ?? ink
  const palette: ThemePaletteColors = {
    neutral,
    ink,
    primary,
    accent: pick("textLink.foreground", "editorLink.activeForeground") ?? primary,
    success: pick("terminal.ansiGreen", "gitDecoration.addedResourceForeground") ?? "#3fa266",
    warning: pick("terminal.ansiYellow", "editorWarning.foreground") ?? "#c18401",
    error: pick("terminal.ansiRed", "editorError.foreground") ?? "#e45649",
    info: pick("terminal.ansiBlue", "editorInfo.foreground") ?? primary,
    diffAdd: pick("gitDecoration.addedResourceForeground", "terminal.ansiGreen") ?? "#3fa266",
    diffDelete: pick("gitDecoration.deletedResourceForeground", "terminal.ansiRed") ?? "#e45649",
  }
  const overrides = syntaxOverrides(theme.tokenColors ?? [])
  const variant = { palette, overrides }
  return { name: theme.name?.trim() || id, id, light: variant, dark: variant }
}

function syntaxOverrides(tokens: TokenColor[]) {
  const byScope = new Map<string, HexColor>()
  for (const token of tokens) {
    const color = hex(token.settings?.foreground)
    if (!color) continue
    const scopes = Array.isArray(token.scope) ? token.scope : (token.scope ?? "").split(",")
    for (const scope of scopes.map((item) => item.trim()).filter(Boolean))
      if (!byScope.has(scope)) byScope.set(scope, color)
  }
  return Object.fromEntries(
    Object.entries(SYNTAX).flatMap(([key, scopes]) => {
      const color = scopes.map((scope) => byScope.get(scope)).find(Boolean)
      return color ? [[key, color]] : []
    }),
  )
}

/** A file name as a theme id: lower case, words joined by dashes, prefixed so it never shadows a built-in. */
export const importedThemeId = (name: string) =>
  `vscode-${
    name
      .toLowerCase()
      .replace(/\.(json|jsonc)$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "theme"
  }`
