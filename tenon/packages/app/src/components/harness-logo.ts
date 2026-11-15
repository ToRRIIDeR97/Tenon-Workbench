// Which logo a harness shows (harness-icon.tsx), kept free of UI imports for tests.

export type HarnessLogo =
  | { kind: "tenon" }
  | { kind: "provider"; id: string }
  /** A harness whose maker has no provider icon: its own bundled mark (`assets/harness-logos`). */
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

// A registered agent is known by what its name says it runs.
const BY_NAME: ReadonlyArray<[RegExp, string]> = [
  [/claude/i, "anthropic"],
  [/codex|openai/i, "openai"],
  [/gemini|google/i, "google"],
  [/opencode/i, "opencode"],
]

/**
 * The built-in agent is Tenon's own loop, so it shows the Tenon mark; Codex, Claude Code and OpenCode show their
 * makers' logos; Antigravity and Command Code show their own marks. Any other agent shows its first letter.
 */
export function harnessLogo(instance: { id: string; name: string }): HarnessLogo {
  const known = BY_ID[instance.id]
  if (known) return known
  const brand = BRANDS.find(([pattern]) => pattern.test(instance.name) || pattern.test(instance.id))
  if (brand) return { kind: "brand", id: brand[1] }
  const named = BY_NAME.find(([pattern]) => pattern.test(instance.name))
  if (named) return { kind: "provider", id: named[1] }
  return { kind: "letter", letter: instance.name.trim().charAt(0).toUpperCase() || "?" }
}
