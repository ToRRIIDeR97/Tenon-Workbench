for (const [name, value] of Object.entries(process.env)) {
  if (value === undefined || !name.toUpperCase().startsWith("OPENCODE_")) continue
  const next = `TENON_${name.slice("OPENCODE_".length)}`
  if (process.env[next] === undefined) process.env[next] = value
}
