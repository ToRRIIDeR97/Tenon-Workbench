import { Config, Context, Effect, Layer } from "effect"

type ConfigMap = Record<string, Config.Config<unknown>>

export type Shape<Fields extends ConfigMap> = {
  readonly [Key in keyof Fields]: Config.Success<Fields[Key]>
}

export type ServiceClass<Self, Id extends string, Service> = Context.ServiceClass<Self, Id, Service> & {
  readonly configLayer: (input: Service) => Layer.Layer<Self>
  readonly layer: Layer.Layer<Self, Config.ConfigError>
}

export const Service =
  <Self>() =>
  <const Id extends string, const Fields extends ConfigMap>(id: Id, fields: Fields) => {
    class ConfigTag extends Context.Service<Self, Shape<Fields>>()(id) {
      static configLayer(input: Shape<Fields>) {
        return Layer.succeed(this, this.of(input))
      }

      static get layer() {
        const tag = this
        return Layer.effect(
          tag,
          Effect.gen(function* () {
            const config = yield* Config.all(fields)
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Config.all preserves the field shape, but its conditional return type also supports iterable inputs.
            return tag.of(config as Shape<Fields>)
          }),
        )
      }
    }

    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- The generated class carries typed static helpers.
    return ConfigTag as ServiceClass<Self, Id, Shape<Fields>>
  }

export * as ConfigService from "./config-service"
