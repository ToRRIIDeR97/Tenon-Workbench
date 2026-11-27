import { createHash } from "node:crypto"

const KEY_BYTES = 32
const CHECK_BYTES = 4
const PHRASE = /^[0-9a-f]{4}(?:-[0-9a-f]{4}){17}$/

export function encodePhrase(key: Uint8Array) {
  if (key.length !== KEY_BYTES) throw new Error("invalid_key")
  return (
    Buffer.from([...key, ...checksum(key)])
      .toString("hex")
      .match(/.{4}/g) ?? []
  ).join("-")
}

export function decodePhrase(phrase: string) {
  const normalized = typeof phrase === "string" ? phrase.trim().toLowerCase() : ""
  if (!PHRASE.test(normalized)) throw new Error("invalid_phrase")
  const bytes = Buffer.from(normalized.replaceAll("-", ""), "hex")
  const key = Uint8Array.from(bytes.subarray(0, KEY_BYTES))
  if (!Buffer.from(checksum(key)).equals(bytes.subarray(KEY_BYTES))) throw new Error("invalid_phrase")
  return key
}

function checksum(key: Uint8Array) {
  return createHash("sha256").update(key).digest().subarray(0, CHECK_BYTES)
}
