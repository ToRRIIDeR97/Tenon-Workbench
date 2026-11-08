import { describe, expect, test } from "bun:test"
import { decryptSecret, encryptSecret } from "./secret-storage"

const storage = (shouldReEncrypt: boolean) => ({
  encryptStringAsync: async (value: string) => Buffer.from(`new:${value}`),
  decryptStringAsync: async (buffer: Buffer) => ({
    result: buffer.toString().replace(/^(old|new):/, ""),
    shouldReEncrypt,
  }),
})

const old = Buffer.from("old:secret").toString("base64")

describe("decryptSecret", () => {
  test("returns the plain text and leaves a current secret alone", async () => {
    const stored: string[] = []
    expect(await decryptSecret(storage(false), old, (value) => stored.push(value))).toBe("secret")
    await Bun.sleep(0)
    expect(stored).toEqual([])
  })

  test("hands a re-encrypted copy to the caller when Electron asks for it", async () => {
    const stored: string[] = []
    expect(await decryptSecret(storage(true), old, (value) => stored.push(value))).toBe("secret")
    await Bun.sleep(0)
    expect(stored).toEqual([await encryptSecret(storage(true), "secret")])
  })

  test("a failed re-encryption still returns the secret", async () => {
    const failing = { ...storage(true), encryptStringAsync: () => Promise.reject(new Error("locked")) }
    expect(await decryptSecret(failing, old, () => {})).toBe("secret")
    expect(
      await decryptSecret(storage(true), old, () => {
        throw new Error("store")
      }),
    ).toBe("secret")
    await Bun.sleep(0)
  })
})
