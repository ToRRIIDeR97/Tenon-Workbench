import { LayerNode } from "@tenon/core/effect/layer-node"
import path from "path"
import { randomUUID } from "crypto"
import { Effect, Layer, Record, Result, Schedule, Schema, Semaphore, Context } from "effect"
import { NonNegativeInt } from "@tenon/core/schema"
import { Global } from "@tenon/core/global"
import { FSUtil } from "@tenon/core/fs-util"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

// Serializes the read-modify-write of auth.json so concurrent sets and removes can't drop a key.
const writeLock = Semaphore.makeUnsafe(1)

// Windows reports a rename over a briefly locked file as EBUSY, EACCES or EPERM. Effect maps the first two
// to Busy and PermissionDenied but leaves EPERM as Unknown, so that one is read from the errno cause.
export function isLockedTarget(reason: { readonly _tag: string; readonly cause?: unknown }) {
  if (reason._tag === "Busy" || reason._tag === "PermissionDenied") return true
  const cause = reason.cause
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM"
}

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@tenon/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    // A missing file is empty; an unreadable or invalid one is an error, so a save never replaces it with {}.
    const read = Effect.fn("Auth.read")(function* () {
      const text = yield* fsys.readFileString(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        Effect.mapError(fail("Failed to read auth data")),
      )
      if (text === undefined) return {}
      const data = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => new AuthError({ message: `${file} is not valid JSON; fix or remove it first` }),
      })
      if (typeof data !== "object" || data === null || Array.isArray(data))
        return yield* new AuthError({ message: `${file} is not a JSON object; fix or remove it first` })
      return Object.fromEntries(Object.entries(data))
    })

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.TENON_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.TENON_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = yield* read().pipe(Effect.orElseSucceed(() => ({})))
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    // Stage the file with owner-only permissions, then rename it over auth.json so a crash or failed
    // write leaves the old or the new content, never a truncated file. POSIX applies the 0o600 mode at
    // creation; Windows ignores it and the file inherits the user profile's ACL. Rename replaces an
    // existing file on both, but Windows refuses it while another process briefly holds the target.
    const save = (data: Record<string, unknown>) =>
      Effect.gen(function* () {
        yield* fsys.ensureDir(path.dirname(file))
        const temp = path.join(path.dirname(file), `.auth.json.${randomUUID()}.tmp`)
        yield* Effect.gen(function* () {
          yield* fsys.writeFileString(temp, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 })
          yield* Effect.suspend(() => fsys.rename(temp, file)).pipe(
            Effect.retry({
              while: (error) => isLockedTarget(error.reason),
              schedule: Schedule.exponential("25 millis"),
              times: 4,
            }),
          )
        }).pipe(Effect.onError(() => fsys.remove(temp).pipe(Effect.ignore)))
      }).pipe(Effect.mapError(fail("Failed to write auth data")))

    // Writes start from the stored entries, not TENON_AUTH_CONTENT, and keep entries this build can't decode.
    const update = (change: (data: Record<string, unknown>) => Record<string, unknown>) =>
      Effect.gen(function* () {
        yield* save(change(yield* read()))
      }).pipe(Effect.uninterruptible, writeLock.withPermits(1))

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      yield* update((data) => {
        const next = { ...data }
        if (norm !== key) delete next[key]
        delete next[norm + "/"]
        return { ...next, [norm]: info }
      })
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      yield* update((data) => {
        const next = { ...data }
        delete next[key]
        delete next[norm]
        return next
      })
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

export * as Auth from "."
