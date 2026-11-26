import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { pairError, type PairCode } from "./error"
import { readDevices, writeDevices, type Device } from "./file"

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
export const CODE_LENGTH = 8
export const CODE_TTL = 5 * 60_000
export const MAX_WRONG_CODES = 5
export const LAST_SEEN_INTERVAL = 60_000
export const NAME_LIMIT = 64

export type Registry = ReturnType<typeof registry>

export function registry(input: { file: string; now?: () => number }) {
  const now = input.now ?? Date.now
  const pending: { code?: { value: string; expiresAt: number; misses: number }; locked: boolean } = { locked: false }
  const serial = queue()

  const refusal = (typed: unknown): PairCode | undefined => {
    if (pending.locked) return "locked"
    const current = pending.code
    if (!current) return "bad_code"
    if (!sameCode(typeof typed === "string" ? normalizeCode(typed) : "", current.value)) {
      current.misses += 1
      if (current.misses >= MAX_WRONG_CODES) {
        pending.code = undefined
        pending.locked = true
      }
      return "bad_code"
    }
    if (now() > current.expiresAt) return "expired"
    return undefined
  }

  return {
    pairingCode() {
      const code = { value: makeCode(), expiresAt: now() + CODE_TTL, misses: 0 }
      pending.code = code
      pending.locked = false
      return { code: code.value, expiresAt: code.expiresAt }
    },

    pair(request: { code: string; name: string }) {
      const refused = refusal(request.code)
      if (refused) return Promise.reject(pairError(refused))
      const name = typeof request.name === "string" ? request.name.trim() : ""
      const length = Array.from(name).length
      if (length < 1 || length > NAME_LIMIT) return Promise.reject(pairError("invalid_name"))
      pending.code = undefined
      const token = randomBytes(32).toString("base64url")
      const device: Device = {
        id: `dev_${randomBytes(8).toString("hex")}`,
        name,
        tokenHash: hashToken(token),
        createdAt: now(),
        lastSeenAt: null,
      }
      return serial(async () => {
        await writeDevices(input.file, [...(await readDevices(input.file, now())), device])
        return { id: device.id, name: device.name, token }
      })
    },

    authenticate(token: string) {
      return serial(async () => {
        if (typeof token !== "string" || token.length === 0) return undefined
        const devices = await readDevices(input.file, now())
        const wanted = Buffer.from(hashToken(token), "hex")
        const found = devices.reduce<Device | undefined>((match, device) => {
          const stored = Buffer.from(device.tokenHash, "hex")
          const same = stored.length === wanted.length && timingSafeEqual(stored, wanted)
          return same ? device : match
        }, undefined)
        if (!found) return undefined
        const time = now()
        if (found.lastSeenAt === null || time - found.lastSeenAt >= LAST_SEEN_INTERVAL)
          await writeDevices(
            input.file,
            devices.map((device) => (device.id === found.id ? { ...device, lastSeenAt: time } : device)),
          ).catch(() => undefined)
        return { id: found.id, name: found.name }
      })
    },

    devices() {
      return serial(async () =>
        (await readDevices(input.file, now())).map((device) => ({
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
        })),
      )
    },

    revoke(id: string) {
      return serial(async () => {
        const devices = await readDevices(input.file, now())
        const remaining = devices.filter((device) => device.id !== id)
        if (remaining.length === devices.length) return false
        await writeDevices(input.file, remaining)
        return true
      })
    },
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function makeCode() {
  return Array.from(randomBytes(CODE_LENGTH), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("")
}

function normalizeCode(typed: string) {
  return typed.replace(/[\s-]/g, "").toUpperCase()
}

function sameCode(typed: string, expected: string) {
  const actual = Buffer.from(typed)
  const wanted = Buffer.from(expected)
  const sameLength = actual.length === wanted.length
  return timingSafeEqual(sameLength ? actual : wanted, wanted) && sameLength
}

function queue() {
  const state: { tail: Promise<unknown> } = { tail: Promise.resolve() }
  return <T>(task: () => Promise<T>) => {
    const run = state.tail.then(task)
    state.tail = run.catch(() => undefined)
    return run
  }
}
