// Same mapping as @tenon/core/legacy-env, for the Electron main process (which does not depend on
// core). Copies each pre-rename OPENCODE_* variable to its TENON_* name when that name is unset;
// the originals stay for the upstream OpenCode CLI. Imported first by index.ts and sidecar.ts.
for (const [name, value] of Object.entries(process.env)) {
  if (value === undefined || !name.toUpperCase().startsWith("OPENCODE_")) continue
  const next = `TENON_${name.slice("OPENCODE_".length)}`
  if (process.env[next] === undefined) process.env[next] = value
}
