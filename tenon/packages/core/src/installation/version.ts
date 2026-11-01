declare global {
  const TENON_VERSION: string
  const TENON_CHANNEL: string
}

export const InstallationVersion = typeof TENON_VERSION === "string" ? TENON_VERSION : "local"
export const InstallationChannel = typeof TENON_CHANNEL === "string" ? TENON_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
