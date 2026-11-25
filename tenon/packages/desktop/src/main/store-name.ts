const STORE_NAME_PATTERN = /^(default|tenon\.[A-Za-z0-9][A-Za-z0-9._-]*)\.dat$/

export function isValidStoreName(name: unknown) {
  return typeof name === "string" && STORE_NAME_PATTERN.test(name)
}

export function assertStoreName(name: unknown) {
  if (!isValidStoreName(name)) throw new Error("Invalid store name")
}

export function assertStoreKey(key: unknown): string {
  if (typeof key !== "string" || key.length === 0) throw new Error("Invalid store key")
  if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Invalid store key")
  return key
}
