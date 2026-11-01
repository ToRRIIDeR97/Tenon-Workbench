export * as LegacyEnv from "./legacy-env"

/**
 * Tenon reads TENON_* variables. Installs configured before the rename may still set the
 * OPENCODE_* spellings, so each one is copied to its TENON_* name when that name is unset.
 * The OPENCODE_* originals stay in place: the upstream OpenCode CLI (harness, WSL server) reads them.
 *
 * Importing this module applies it to `process.env`; process entry points import it first so
 * modules that read the environment at load time see the Tenon names.
 */
export function apply(env: Record<string, string | undefined> = process.env) {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.toUpperCase().startsWith("OPENCODE_")) continue
    const next = `TENON_${name.slice("OPENCODE_".length)}`
    if (env[next] === undefined) env[next] = value
  }
  return env
}

apply()
