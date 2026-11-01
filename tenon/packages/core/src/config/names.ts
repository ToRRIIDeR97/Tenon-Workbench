export * as ConfigNames from "./names"

/**
 * Config file base names (`<name>.json`, `<name>.jsonc`), lowest priority first. The pre-rename
 * OpenCode names still load so existing setups keep working; the Tenon names win when both exist.
 */
export const files = ["opencode", "tenon"] as const

/** Config directories in a project or home folder, lowest priority first. */
export const directories = [".opencode", ".tenon"] as const

/** Whether `name` (a base name) is one of the config directories. */
export const isDirectory = (name: string) => (directories as readonly string[]).includes(name)
