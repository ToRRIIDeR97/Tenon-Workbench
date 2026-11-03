import { describe, expect, test } from "bun:test"
import { isCommandThread } from "../../../../tenon/packages/app/src/features/command-centre/command-centre"

describe("AC-2 Command Centre threads are recognised by their folder", () => {
  test("AC-2 the vault's .command-centre folder, in either separator style", () => {
    expect(isCommandThread("/Users/me/Documents/Tenon/.command-centre")).toBe(true)
    expect(isCommandThread("/Users/me/Documents/Tenon/.command-centre/")).toBe(true)
    expect(isCommandThread("C:\\Users\\me\\Documents\\Tenon\\.command-centre")).toBe(true)
  })

  test("AC-2 Project and workspace folders are not Command Centre threads", () => {
    expect(isCommandThread("/Users/me/Documents/Tenon/acme/Acme API")).toBe(false)
    expect(isCommandThread("/Users/me/code/.command-centre-notes")).toBe(false)
    expect(isCommandThread("/Users/me/Documents/Tenon/.command-centre/memory")).toBe(false)
    expect(isCommandThread(undefined)).toBe(false)
    expect(isCommandThread("")).toBe(false)
  })
})
