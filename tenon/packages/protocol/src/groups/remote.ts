import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError } from "../errors"

export const RemoteDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Number,
  lastSeenAt: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "Remote.Device" })

export const RemoteGroup = HttpApiGroup.make("server.remote")
  .add(
    HttpApiEndpoint.post("remote.pairingCode", "/api/remote/pairing-code", {
      success: Schema.Struct({ code: Schema.String, expiresAt: Schema.Number }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.remote.pairingCode",
        summary: "Make a pairing code",
        description:
          "Makes an eight-character code a phone can pair with for five minutes, cancelling any earlier code. Never callable with a device token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("remote.devices", "/api/remote/devices", {
      success: Schema.Struct({ devices: Schema.Array(RemoteDevice) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.remote.devices",
        summary: "List paired devices",
        description: "Lists the devices paired with this computer. Never callable with a device token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("remote.revoke", "/api/remote/devices/:id", {
      params: { id: Schema.String },
      success: Schema.Struct({ removed: Schema.Boolean }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.remote.revoke",
        summary: "Revoke a paired device",
        description: "Removes a paired device; its token stops working at once. Never callable with a device token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("remote.streamTicket", "/api/remote/stream-ticket", {
      success: Schema.Struct({ ticket: Schema.String, expiresAt: Schema.Number }),
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.remote.streamTicket",
        summary: "Get an event stream ticket",
        description:
          "For a paired device only: a single-use ticket, good for one minute, that opens one event stream when passed as the ticket query parameter.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "remote access", description: "Paired devices and their companion access." }),
  )
