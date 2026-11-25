import type { Channel } from "./constants"

export function stableDatabaseName(channel: Channel, packaged: boolean) {
  if (!packaged) return undefined
  return channel === "prod" ? "tenon.db" : `tenon-${channel}.db`
}
