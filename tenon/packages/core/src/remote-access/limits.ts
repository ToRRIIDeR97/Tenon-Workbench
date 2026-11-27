import { randomBytes } from "node:crypto"

export const STREAM_TICKET_TTL = 60_000
export const PAIR_ATTEMPTS_PER_MINUTE = 10
const CAPACITY = 10_000

export type StreamTickets = ReturnType<typeof streamTickets>
export type Limiter = ReturnType<typeof limiter>

export function streamTickets(input: { now?: () => number; ttl?: number } = {}) {
  const now = input.now ?? Date.now
  const ttl = input.ttl ?? STREAM_TICKET_TTL
  const issued = new Map<string, { deviceID: string; expiresAt: number }>()
  return {
    issue(deviceID: string) {
      const time = now()
      issued.forEach((entry, ticket) => entry.expiresAt < time && issued.delete(ticket))
      if (issued.size >= CAPACITY) issued.delete(issued.keys().next().value ?? "")
      const ticket = randomBytes(32).toString("base64url")
      const expiresAt = time + ttl
      issued.set(ticket, { deviceID, expiresAt })
      return { ticket, expiresAt }
    },
    redeem(ticket: string) {
      const entry = issued.get(ticket)
      issued.delete(ticket)
      if (!entry || now() > entry.expiresAt) return undefined
      return entry.deviceID
    },
  }
}

export function limiter(input: { limit: number; window: number; now?: () => number }) {
  const now = input.now ?? Date.now
  const windows = new Map<string, { start: number; count: number }>()
  return {
    take(key: string) {
      const time = now()
      const current = windows.get(key)
      if (current && time - current.start < input.window) {
        current.count += 1
        return current.count <= input.limit
      }
      windows.forEach((entry, address) => time - entry.start >= input.window && windows.delete(address))
      if (windows.size >= CAPACITY) windows.delete(windows.keys().next().value ?? "")
      windows.set(key, { start: time, count: 1 })
      return true
    },
  }
}
