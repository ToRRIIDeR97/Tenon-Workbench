export type InterfaceEntry = { address: string; family: string | number; internal: boolean }
export type OfferedAddress = { address: string; name: string }
export type RemoteConfig = { enabled: boolean; address: string; port: number }

export const DEFAULT_PORT = 47100

export function lanAddresses(interfaces: Record<string, ReadonlyArray<InterfaceEntry> | undefined>) {
  const entries = Object.entries(interfaces).flatMap(([name, list]) =>
    (list ?? []).flatMap((entry) => {
      if (!entry || entry.internal || typeof entry.address !== "string") return []
      const family =
        entry.family === 4 || entry.family === "IPv4" ? 4 : entry.family === 6 || entry.family === "IPv6" ? 6 : 0
      if (family === 0) return []
      if (family === 6 && /^fe[89ab]/i.test(entry.address)) return []
      if (entry.address.startsWith("127.") || entry.address === "::1") return []
      return [{ family, offered: { address: entry.address, name } satisfies OfferedAddress }]
    }),
  )
  return [...entries.filter((entry) => entry.family === 4), ...entries.filter((entry) => entry.family === 6)].map(
    (entry) => entry.offered,
  )
}

export function validateRemoteConfig(input: RemoteConfig, offered: ReadonlyArray<OfferedAddress>): RemoteConfig {
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error("remote_port_invalid")
  if (!input.enabled)
    return { enabled: false, address: typeof input.address === "string" ? input.address : "", port: input.port }
  if (!offered.some((item) => item.address === input.address)) throw new Error("remote_address_invalid")
  return { enabled: true, address: input.address, port: input.port }
}
