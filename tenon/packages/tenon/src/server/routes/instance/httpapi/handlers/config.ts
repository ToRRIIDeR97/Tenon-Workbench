import { Config } from "@/config/config"
import { redactSecrets } from "@/config/redact"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return redactSecrets(yield* configSvc.get())
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toRendererInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const trust = Effect.fn("ConfigHttpApi.trust")(function* () {
      return yield* configSvc.trust()
    })

    const approveFolder = Effect.fn("ConfigHttpApi.approveFolder")(function* () {
      yield* configSvc.approveFolder()
      // Disposal also reopens the location, so both config readers start over.
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return { root: (yield* configSvc.trust()).root, trusted: true, withheld: [] }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("trust", trust)
      .handle("approveFolder", approveFolder)
  }),
)
