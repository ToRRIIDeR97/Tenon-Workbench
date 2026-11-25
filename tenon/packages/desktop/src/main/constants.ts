export type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.TENON_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATER_ENABLED = false

export const DEEP_LINK_SCHEME = "tenon"
