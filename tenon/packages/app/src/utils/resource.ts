import type { Resource } from "solid-js"

/**
 * A resource's latest value, without its suspending read. `resource.latest` suspends until the first value
 * arrives, and a route that reads it during render makes the router hold the old page until then. This returns
 * undefined instead, so the page opens at once with its own loading state.
 */
export function settled<T>(resource: Resource<T>) {
  return resource.state === "ready" || resource.state === "refreshing" ? resource.latest : undefined
}
