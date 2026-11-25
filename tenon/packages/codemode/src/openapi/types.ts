import { Effect } from "effect"
import { HttpClient } from "effect/http"
import type { Definition, JsonSchema } from "../tool.js"

export type Document = Record<string, unknown>

export type Operation = {
  readonly operationId: string | undefined
  readonly method: string
  readonly path: string
  readonly summary: string | undefined
  readonly description: string | undefined
}

export type SecurityScheme =
  | { readonly type: "apiKey"; readonly name: string; readonly in: "header" | "query" | "cookie" }
  | { readonly type: "http"; readonly scheme: string }
  | { readonly type: "oauth2" }
  | { readonly type: "openIdConnect" }

export type Credential =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | { readonly type: "apiKey"; readonly value: string }
  | { readonly type: "header"; readonly name: string; readonly value: string }

export type AuthResolver = (context: {
  readonly name: string
  readonly definition: SecurityScheme
  readonly scopes: ReadonlyArray<string>
  readonly operation: Operation
}) => Effect.Effect<Credential | undefined, unknown>

export type Options = {
  readonly spec: Document
  readonly baseUrl?: string | undefined
  readonly auth?: { readonly resolve: AuthResolver } | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
}

export type Skipped = {
  readonly method: string
  readonly path: string
  readonly reason: string
}

export type Tools = { [name: string]: Definition<HttpClient.HttpClient> | Tools }

export type Result = {
  readonly tools: Tools
  readonly skipped: ReadonlyArray<Skipped>
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

export type InputLocation = "path" | "query" | "header" | "body"

export type InputField = {
  readonly inputName: string
  readonly name: string
  readonly location: InputLocation
  readonly required: boolean
  readonly schema: JsonSchema
  readonly style: "simple" | "form" | "deepObject" | undefined
  readonly explode: boolean | undefined
}

export type Body = { readonly required: boolean; readonly mode: "object" | "value"; readonly mediaType: string }

export type OperationInput = {
  readonly fields: ReadonlyArray<InputField>
  readonly body: Body | undefined
}

export type SecurityRequirement = Readonly<Record<string, ReadonlyArray<string>>>

export type Plan = {
  readonly operation: Operation
  readonly url: string
  readonly fields: ReadonlyArray<InputField>
  readonly body: Body | undefined
  readonly security: ReadonlyArray<SecurityRequirement>
  readonly schemes: Readonly<Record<string, SecurityScheme>>
  readonly auth: { readonly resolve: AuthResolver } | undefined
  readonly headers: Readonly<Record<string, string>>
}

export type AppliedAuth = {
  readonly headers: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
}
