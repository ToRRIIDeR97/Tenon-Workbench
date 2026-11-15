// Which logo a harness shows (harness-icon.tsx), kept free of UI imports for tests.

export type HarnessLogo = { kind: "tenon" } | { kind: "provider"; id: string } | { kind: "letter"; letter: string }

const BY_ID: Record<string, HarnessLogo> = {
  opencode: { kind: "tenon" },
  codex: { kind: "provider", id: "openai" },
  "opencode-acp": { kind: "provider", id: "opencode" },
  "claude-code": { kind: "provider", id: "anthropic" },
}

// A registered agent is known by what its name says it runs.
const BY_NAME: ReadonlyArray<[RegExp, string]> = [
  [/claude/i, "anthropic"],
  [/codex|openai/i, "openai"],
  [/gemini|google/i, "google"],
  [/opencode/i, "opencode"],
]

/**
 * The built-in agent is Tenon's own loop, so it shows the Tenon mark; Codex, Claude Code and OpenCode show their
 * makers' logos. Any other agent (Command Code, a custom ACP agent) shows its first letter.
 */
export function harnessLogo(instance: { id: string; name: string }): HarnessLogo {
  const known = BY_ID[instance.id]
  if (known) return known
  const named = BY_NAME.find(([pattern]) => pattern.test(instance.name))
  if (named) return { kind: "provider", id: named[1] }
  return { kind: "letter", letter: instance.name.trim().charAt(0).toUpperCase() || "?" }
}
