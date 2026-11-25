export * as ConfigNames from "./names"

export const files = ["opencode", "tenon"] as const

export const directories = [".opencode", ".tenon"] as const

export const isDirectory = (name: string) => (directories as readonly string[]).includes(name)
