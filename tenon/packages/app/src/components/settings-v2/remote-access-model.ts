import qrcode from "qrcode-generator"

export type PairedDevice = { id: string; name: string; createdAt: number; lastSeenAt: number | null }

export type SeenLabel =
  | { key: "secondBrain.settings.remote.seen.never" }
  | { key: "secondBrain.settings.remote.seen.now" }
  | { key: "secondBrain.settings.remote.seen.minutes"; minutes: number }
  | { key: "secondBrain.settings.remote.seen.hours"; hours: number }
  | { key: "secondBrain.settings.remote.seen.days"; days: number }

const PAIR_PREFIX = "tenon://pair?"

export function pairingLink(input: { url: string; code: string }) {
  return `${PAIR_PREFIX}${new URLSearchParams({ server: input.url, code: input.code }).toString()}`
}

export function parsePairingLink(link: string) {
  if (!link.startsWith(PAIR_PREFIX)) return undefined
  const params = new URLSearchParams(link.slice(PAIR_PREFIX.length))
  const url = URL.parse(params.get("server") ?? "")
  const code = params.get("code")
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !code) return undefined
  return { url: url.origin, code }
}

export function deviceRows(devices: ReadonlyArray<PairedDevice>, now: number) {
  return [...devices]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      seen: seenLabel(device.lastSeenAt, now),
    }))
}

export function qrPath(text: string) {
  const code = qrcode(0, "M")
  code.addData(text)
  code.make()
  const size = code.getModuleCount()
  const cells = Array.from({ length: size * size }, (_, index) => ({
    row: Math.floor(index / size),
    col: index % size,
  }))
  const path = cells
    .filter((cell) => code.isDark(cell.row, cell.col))
    .map((cell) => `M${cell.col} ${cell.row}h1v1h-1z`)
    .join("")
  return { size, path }
}

function seenLabel(lastSeenAt: number | null, now: number): SeenLabel {
  if (lastSeenAt === null) return { key: "secondBrain.settings.remote.seen.never" }
  const minutes = Math.floor((now - lastSeenAt) / 60_000)
  if (minutes < 1) return { key: "secondBrain.settings.remote.seen.now" }
  if (minutes < 60) return { key: "secondBrain.settings.remote.seen.minutes", minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: "secondBrain.settings.remote.seen.hours", hours }
  return { key: "secondBrain.settings.remote.seen.days", days: Math.floor(hours / 24) }
}
