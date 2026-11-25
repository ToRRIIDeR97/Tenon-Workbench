import type { WslDistroProbe, WslOpencodeCheck, WslServerItem } from "../../preload/types"

export function wslServerIdToRestart(servers: WslServerItem[], distro: string) {
  return servers.find((item) => item.config.distro === distro)?.config.id
}

export function clearWslDistroState(
  distroProbes: Record<string, WslDistroProbe>,
  opencodeChecks: Record<string, WslOpencodeCheck>,
  distro: string,
) {
  const nextDistroProbes = { ...distroProbes }
  const nextOpencodeChecks = { ...opencodeChecks }
  delete nextDistroProbes[distro]
  delete nextOpencodeChecks[distro]
  return { distroProbes: nextDistroProbes, opencodeChecks: nextOpencodeChecks }
}

const WSL_DISTRO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function wslTerminalArgs(distro?: string | null) {
  return ["/c", "start", "", "wsl.exe", ...(distro ? ["-d", requireWslDistro(distro)] : [])]
}

export function requireWslDistro(value: unknown) {
  if (typeof value === "string" && WSL_DISTRO_PATTERN.test(value)) return value
  throw new Error("Invalid distro")
}

export function validWslDistros(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Invalid distro")
  return value.filter((item): item is string => typeof item === "string" && WSL_DISTRO_PATTERN.test(item))
}

export function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}
