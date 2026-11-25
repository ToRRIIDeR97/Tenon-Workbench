import { Global } from "@tenon/core/global"
import { HarnessComputerProxy } from "@tenon/core/harness/computer-proxy"
import { HarnessComputerUse } from "@tenon/core/harness/computer-use"
import { Location } from "@tenon/core/location"
import { LocationServiceMap } from "@tenon/core/location-services"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

const state = Effect.fn("ComputerUse.state")(function* (enabled?: boolean) {
  const location = yield* Location.Service
  const config = Global.make().config
  const locations = yield* LocationServiceMap.Service
  if (enabled !== undefined) {
    yield* Effect.promise(() => HarnessComputerUse.setEnabled(location.directory, enabled, config))
    yield* locations.invalidate({ directory: location.directory }).pipe(Effect.ignore)
  }
  return yield* Effect.promise(async () => {
    const driver = HarnessComputerUse.findDriver()
    const status = await HarnessComputerUse.status({ driver, platform: process.platform })
    return {
      enabled: await HarnessComputerUse.enabledFor(location.directory, config),
      ...status,
      platform: process.platform,
      stopped: HarnessComputerProxy.shared.stoppedIn(location.directory),
    }
  })
})

export const ComputerUseHandler = HttpApiBuilder.group(Api, "server.computerUse", (handlers) =>
  handlers
    .handle("computerUse.get", () => response(state()))
    .handle("computerUse.set", (ctx) => response(state(ctx.payload.enabled))),
)
