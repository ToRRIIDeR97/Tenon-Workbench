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

export const FRAME_INSET = 8
export const PLACEHOLDER_FRAME = { width: 1080, height: 2400 }

export function fitFrame(input: {
  boxWidth: number
  boxHeight: number
  imageWidth: number
  imageHeight: number
  inset: number
  below?: number
}): { width: number; height: number } {
  const room = {
    width: input.boxWidth - 2 * input.inset,
    height: input.boxHeight - 2 * input.inset - (input.below ?? 0),
  }
  if (input.imageWidth <= 0 || input.imageHeight <= 0 || room.width <= 0 || room.height <= 0)
    return { width: 0, height: 0 }
  const scale = Math.min(room.width / input.imageWidth, room.height / input.imageHeight, 1)
  return {
    width: Math.min(Math.round(input.imageWidth * scale), Math.floor(room.width)),
    height: Math.min(Math.round(input.imageHeight * scale), Math.floor(room.height)),
  }
}

export function deviceError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  const cleaned = message
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(?:\w*Error:\s*)+/i, "")
    .trim()
  return cleaned || message
}

export function deviceHint(device: { platform: "android" | "ios"; state: string }): DeviceHint | undefined {
  if (device.platform !== "android") return undefined
  if (device.state === "unauthorized" || device.state === "offline") return device.state
  return undefined
}
