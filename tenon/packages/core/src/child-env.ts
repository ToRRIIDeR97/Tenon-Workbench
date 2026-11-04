export * as ChildEnv from "./child-env"

/**
 * Variables that authenticate a client to the local server or to the desktop's mail and browser
 * bridges. Terminals, agent shell commands, and MCP or LSP servers run code the user or the model
 * chose, so they must not inherit them. Every other variable is kept so user tools keep working,
 * including TENON_DELEGATION_TOKEN, which harness children need.
 */
// The OPENCODE_ names are the pre-rename spellings, still honoured by legacy-env.ts.
const serverCredentials = new Set([
  "TENON_SERVER_PASSWORD",
  "TENON_SERVER_USERNAME",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
  "TENON_MAIL_URL",
  "TENON_MAIL_TOKEN",
  "TENON_BROWSER_URL",
  "TENON_BROWSER_TOKEN",
])

/** Returns a copy of `source` (default `process.env`) without the credential variables. */
export function from(source: Readonly<Record<string, string | undefined>> = process.env) {
  // Windows environment names are case-insensitive.
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => !serverCredentials.has(name.toUpperCase())),
  ) as Record<string, string | undefined>
}
