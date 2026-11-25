export * as LegacyEnv from "./legacy-env"

export function apply(env: Record<string, string | undefined> = process.env) {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.toUpperCase().startsWith("OPENCODE_")) continue
    const next = `TENON_${name.slice("OPENCODE_".length)}`
    if (env[next] === undefined) env[next] = value
  }
  return env
}

apply()
