import { createHash } from "node:crypto"
import { Option, Schema } from "effect"
import type { EventV2 } from "../event"
import { syncError } from "./error"

const KEY_BYTES = 32
const CHECK_BYTES = 4
const NONCE_BYTES = 12
const TAG_BYTES = 16
const VERSION = 1
const MAGIC = new TextEncoder().encode("TSY1")

const SegmentEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  seq: Schema.Number,
  aggregateID: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
const SegmentBody = Schema.Struct({ events: Schema.Array(SegmentEvent) })
const decodeSegmentBody = Schema.decodeUnknownOption(Schema.fromJsonString(SegmentBody))

export function generateKey() {
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  return { key, phrase: phraseOf(key) }
}

export function keyFromPhrase(phrase: string) {
  const normalized = typeof phrase === "string" ? phrase.trim().toLowerCase() : ""
  if (!/^[0-9a-f]{4}(?:-[0-9a-f]{4}){17}$/.test(normalized)) throw syncError("invalid_key", "This is not a sync key")
  const bytes = Uint8Array.from(Buffer.from(normalized.replaceAll("-", ""), "hex"))
  const key = bytes.slice(0, KEY_BYTES)
  if (!Buffer.from(checksum(key)).equals(Buffer.from(bytes.slice(KEY_BYTES))))
    throw syncError("invalid_key", "This is not a sync key")
  return key
}

export function requireKey(key: Uint8Array) {
  if (!isKey(key)) throw syncError("invalid_key", `A sync key is ${KEY_BYTES} bytes`)
  return key
}

export function isKey(key: unknown): key is Uint8Array {
  return key instanceof Uint8Array && key.length === KEY_BYTES
}

export async function seal(input: {
  key: Uint8Array
  sessionID: string
  previous: string | null
  events: ReadonlyArray<EventV2.SerializedEvent>
}) {
  requireKey(input.key)
  const range = requireRun(input.events, input.sessionID)
  const bytes = await encrypt(
    input.key,
    segmentContext(input.sessionID, input.previous),
    JSON.stringify({ events: input.events }),
  )
  return { bytes, hash: await hashOf(bytes), first: range.first, last: range.last }
}

export async function open(input: { key: Uint8Array; sessionID: string; previous: string | null; bytes: Uint8Array }) {
  requireKey(input.key)
  const text = await decrypt(input.key, segmentContext(input.sessionID, input.previous), input.bytes)
  const body = Option.getOrUndefined(decodeSegmentBody(text))
  if (!body) throw syncError("invalid_segment", "The segment does not hold events")
  const events = body.events.map((event) => ({ ...event, data: { ...event.data } }) as EventV2.SerializedEvent)
  const range = requireRun(events, input.sessionID)
  return { events, hash: await hashOf(input.bytes), first: range.first, last: range.last }
}

export function encrypt(key: Uint8Array, context: string, text: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  return importKey(key)
    .then((imported) =>
      crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(context) },
        imported,
        new TextEncoder().encode(text),
      ),
    )
    .then((cipher) => {
      const bytes = new Uint8Array(MAGIC.length + NONCE_BYTES + cipher.byteLength)
      bytes.set(MAGIC, 0)
      bytes.set(nonce, MAGIC.length)
      bytes.set(new Uint8Array(cipher), MAGIC.length + NONCE_BYTES)
      return bytes
    })
}

export async function decrypt(key: Uint8Array, context: string, bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.length < MAGIC.length + NONCE_BYTES + TAG_BYTES)
    throw syncError("unreadable", "The sealed bytes cannot be opened")
  if (!Buffer.from(bytes.subarray(0, MAGIC.length)).equals(Buffer.from(MAGIC)))
    throw syncError("unreadable", "The sealed bytes cannot be opened")
  const imported = await importKey(key)
  const plain = await crypto.subtle
    .decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(MAGIC.length, MAGIC.length + NONCE_BYTES),
        additionalData: new TextEncoder().encode(context),
      },
      imported,
      bytes.slice(MAGIC.length + NONCE_BYTES),
    )
    .catch(() => undefined)
  if (!plain) throw syncError("unreadable", "The sealed bytes cannot be opened with this key")
  return new TextDecoder().decode(plain)
}

export async function hashOf(bytes: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))).toString("hex")
}

export function manifestContext(sessionID: string) {
  return JSON.stringify(["tenon-thread-sync", VERSION, "manifest", sessionID])
}

function segmentContext(sessionID: string, previous: string | null) {
  return JSON.stringify(["tenon-thread-sync", VERSION, "segment", sessionID, previous])
}

function importKey(key: Uint8Array) {
  return crypto.subtle.importKey("raw", Uint8Array.from(requireKey(key)), "AES-GCM", false, ["encrypt", "decrypt"])
}

function requireRun(events: ReadonlyArray<EventV2.SerializedEvent>, sessionID: string) {
  const first = Array.isArray(events) ? events[0]?.seq : undefined
  if (typeof first !== "number" || !Number.isSafeInteger(first) || first < 0)
    throw syncError("invalid_segment", "A segment holds one or more events")
  if (
    !events.every(
      (event, index) =>
        typeof event === "object" &&
        event !== null &&
        event.aggregateID === sessionID &&
        event.seq === first + index &&
        typeof event.id === "string" &&
        typeof event.type === "string",
    )
  )
    throw syncError("invalid_segment", "A segment holds consecutive events of one thread")
  return { first, last: first + events.length - 1 }
}

function phraseOf(key: Uint8Array) {
  return (
    Buffer.from([...key, ...checksum(key)])
      .toString("hex")
      .match(/.{4}/g) ?? []
  ).join("-")
}

function checksum(key: Uint8Array) {
  return Uint8Array.from(createHash("sha256").update(key).digest()).slice(0, CHECK_BYTES)
}
