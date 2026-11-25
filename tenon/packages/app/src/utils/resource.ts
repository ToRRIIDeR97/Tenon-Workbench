import type { Resource } from "solid-js"

export function settled<T>(resource: Resource<T>) {
  return resource.state === "ready" || resource.state === "refreshing" ? resource.latest : undefined
}
