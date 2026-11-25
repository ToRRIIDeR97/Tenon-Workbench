import type { SafeStorage } from "electron"

type Storage = Pick<SafeStorage, "encryptStringAsync" | "decryptStringAsync">

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
