import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { SchemaErrorMiddleware } from "../middleware/schema-error"

export const REMOTE_PAIR_PATH = "/remote/pair"

export class PairingRefused extends Schema.TaggedError<PairingRefused>()(
  "PairingRefused",
  { code: Schema.Literals(["bad_code", "expired", "locked"]), message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class PairingInvalidName extends Schema.TaggedError<PairingInvalidName>()(
  "PairingInvalidName",
  { code: Schema.Literal("invalid_name"), message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class PairingRateLimited extends Schema.TaggedError<PairingRateLimited>()(
  "PairingRateLimited",
  { message: Schema.String },
  { httpApiStatus: 429 },
) {}

export const RemotePairApi = HttpApi.make("tenon-remote-pair")
  .add(
    HttpApiGroup.make("remotePair").add(
      HttpApiEndpoint.post("pair", REMOTE_PAIR_PATH, {
        payload: Schema.Struct({ code: Schema.String, name: Schema.String }),
        success: Schema.Struct({ id: Schema.String, name: Schema.String, token: Schema.String }),
        error: [PairingRefused, PairingInvalidName, PairingRateLimited],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "remote.pair",
          summary: "Pair a device",
          description:
            "The one route that needs no credential: trade the pairing code shown on this computer for a device token, returned once. Ten attempts a minute per address.",
        }),
      ),
    ),
  )
  .middleware(SchemaErrorMiddleware)
