// Renderer-supplied store names become file names under userData. Only the
// renderer's own stores are addressable: the legacy "default.dat" and the
// "tenon.<scope>.dat" files built by app/src/utils/persist.ts. Main-owned
// files (tenon.settings, tenon.updater, second-brain.google, window
// state, Chromium Preferences) never end in ".dat" and are rejected, as are
// separators, leading dots and Windows drive prefixes (issue #24).
const STORE_NAME_PATTERN = /^(default|tenon\.[A-Za-z0-9][A-Za-z0-9._-]*)\.dat$/

export function isValidStoreName(name: unknown) {
  return typeof name === "string" && STORE_NAME_PATTERN.test(name)
}

export function assertStoreName(name: unknown) {
  if (!isValidStoreName(name)) throw new Error("Invalid store name")
}

/** A renderer-supplied key inside a store: a non-empty string that can't reach an object's prototype. */
export function assertStoreKey(key: unknown): string {
  if (typeof key !== "string" || key.length === 0) throw new Error("Invalid store key")
  if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Invalid store key")
  return key
}
