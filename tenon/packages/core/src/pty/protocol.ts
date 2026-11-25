export * as PtyProtocol from "./protocol"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

export const REPLAY_CHUNK = 64 * 1024

export function metaFrame(cursor: number) {
  const bytes = encoder.encode(JSON.stringify({ cursor }))
  const out = new Uint8Array(bytes.length + 1)
  out[0] = 0
  out.set(bytes, 1)
  return out
}

export function chunks(data: string) {
  const out: string[] = []
  for (let i = 0; i < data.length; i += REPLAY_CHUNK) out.push(data.slice(i, i + REPLAY_CHUNK))
  return out
}

export function decodeInput(message: string | Uint8Array | ArrayBuffer) {
  if (typeof message === "string") return message
  try {
    return decoder.decode(message instanceof ArrayBuffer ? new Uint8Array(message) : message)
  } catch {
    return undefined
  }
}

export const MAX_PENDING_BYTES = 4 * 1024 * 1024
export const TOO_SLOW_CLOSE = { code: 4409, reason: "client too slow" } as const

export function pendingBudget(limit = MAX_PENDING_BYTES) {
  let pending = 0
  let overflowed = false
  const size = (chunk: string | Uint8Array) => (typeof chunk === "string" ? chunk.length : chunk.byteLength)
  return {
    admit(chunk: string | Uint8Array): "send" | "close" | "drop" {
      if (overflowed) return "drop"
      if (pending + size(chunk) > limit) {
        overflowed = true
        return "close"
      }
      pending += size(chunk)
      return "send"
    },
    sent(chunk: string | Uint8Array) {
      pending -= size(chunk)
    },
  }
}
