import type { SafeStorage } from "electron"

type Storage = Pick<SafeStorage, "encryptStringAsync" | "decryptStringAsync">

/**
 * Decrypts a base64 secret written by safeStorage. Electron documents that data from the deprecated
 * `encryptString` decrypts with `decryptStringAsync`, so secrets stored before Electron 45 keep working.
 * When Electron reports `shouldReEncrypt` (the key rotated, or a stronger one is available), the secret is
 * re-encrypted in the background and handed to `onReEncrypt` to store; a failure there leaves the old copy,
 * which still decrypts.
 */
export async function decryptSecret(storage: Storage, value: string, onReEncrypt?: (encrypted: string) => void) {
  const { result, shouldReEncrypt } = await storage.decryptStringAsync(Buffer.from(value, "base64"))
  if (shouldReEncrypt && onReEncrypt) {
    void encryptSecret(storage, result)
      .then(onReEncrypt)
      .catch(() => undefined)
  }
  return result
}

export async function encryptSecret(storage: Storage, value: string) {
  return (await storage.encryptStringAsync(value)).toString("base64")
}
