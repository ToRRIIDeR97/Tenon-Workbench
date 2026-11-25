import type { LLMRequest } from "../schema"
import * as ProviderShared from "../protocols/shared"

export interface EndpointInput<Body> {
  readonly request: LLMRequest
  readonly body: Body
}

export type EndpointPart<Body> = string | ((input: EndpointInput<Body>) => string)

export interface Endpoint<Body> {
  readonly baseURL?: string
  readonly path: EndpointPart<Body>
  readonly query?: Record<string, string>
}

export type EndpointPatch<Body> = Partial<Endpoint<Body>>

export const path = <Body>(value: EndpointPart<Body>, options: Omit<Endpoint<Body>, "path"> = {}): Endpoint<Body> => ({
  ...options,
  path: value,
})

export const merge = <Body>(base: Endpoint<Body>, patch: EndpointPatch<Body>): Endpoint<Body> => ({
  ...base,
  ...patch,
  baseURL: patch.baseURL ?? base.baseURL,
  path: patch.path ?? base.path,
  query: patch.query === undefined ? base.query : { ...base.query, ...patch.query },
})

const renderPart = <Body>(part: EndpointPart<Body>, input: EndpointInput<Body>) =>
  typeof part === "function" ? part(input) : part

export const render = <Body>(endpoint: Endpoint<Body>, input: EndpointInput<Body>) => {
  const url = new URL(`${ProviderShared.trimBaseUrl(endpoint.baseURL ?? "")}${renderPart(endpoint.path, input)}`)
  for (const [key, value] of Object.entries(endpoint.query ?? {})) url.searchParams.set(key, value)
  return url
}

export * as Endpoint from "./endpoint"
