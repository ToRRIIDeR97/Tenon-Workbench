export * as ChildEnv from "./child-env"

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

export function from(source: Readonly<Record<string, string | undefined>> = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => !serverCredentials.has(name.toUpperCase())),
  ) as Record<string, string | undefined>
}
