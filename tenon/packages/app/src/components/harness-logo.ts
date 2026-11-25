export type HarnessLogo =
  | { kind: "tenon" }
  | { kind: "provider"; id: string }
  | { kind: "brand"; id: "antigravity" | "command-code" }
  | { kind: "letter"; letter: string }

const BY_ID: Record<string, HarnessLogo> = {
  opencode: { kind: "tenon" },
  codex: { kind: "provider", id: "openai" },
  "opencode-acp": { kind: "provider", id: "opencode" },
  "claude-code": { kind: "provider", id: "anthropic" },
}

const BRANDS: ReadonlyArray<[RegExp, "antigravity" | "command-code"]> = [
  [/antigravity/i, "antigravity"],
  [/command.?code/i, "command-code"],
]

const BY_NAME: ReadonlyArray<[RegExp, string]> = [
  [/claude/i, "anthropic"],
  [/codex|openai/i, "openai"],
  [/gemini|google/i, "google"],
  [/opencode/i, "opencode"],
]

export function harnessLogo(instance: { id: string; name: string }): HarnessLogo {
  const known = BY_ID[instance.id]
  if (known) return known
  const brand = BRANDS.find(([pattern]) => pattern.test(instance.name) || pattern.test(instance.id))
  if (brand) return { kind: "brand", id: brand[1] }
  const named = BY_NAME.find(([pattern]) => pattern.test(instance.name))
  if (named) return { kind: "provider", id: named[1] }
  return { kind: "letter", letter: instance.name.trim().charAt(0).toUpperCase() || "?" }
}
