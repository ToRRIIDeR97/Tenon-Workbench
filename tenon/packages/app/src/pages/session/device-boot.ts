export type BootStage = "idle" | "starting" | "slow" | "timeout"
export type DeviceHint = "unauthorized" | "offline"

export const BOOT_SLOW_MS = 60_000
export const BOOT_TIMEOUT_MS = 180_000
export const BOOT_POLL_MS = 2_000

export function bootStage(input: { requestedAt: number | undefined; now: number; running: boolean }): BootStage {
  if (input.requestedAt === undefined || input.running) return "idle"
  const elapsed = input.now - input.requestedAt
  if (elapsed >= BOOT_TIMEOUT_MS) return "timeout"
  if (elapsed >= BOOT_SLOW_MS) return "slow"
  return "starting"
}

export function deviceHint(device: { platform: "android" | "ios"; state: string }): DeviceHint | undefined {
  if (device.platform !== "android") return undefined
  if (device.state === "unauthorized" || device.state === "offline") return device.state
  return undefined
}
