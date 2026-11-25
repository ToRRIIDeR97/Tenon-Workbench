import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigLSPV1 } from "@tenon/core/v1/config/lsp"

describe("ConfigLSPV1.Info refinement", () => {
  const decodeEffect = Schema.decodeUnknownSync(ConfigLSPV1.Info)

  describe("accepted inputs", () => {
    test("true and false pass (top-level toggle)", () => {
      expect(decodeEffect(true)).toBe(true)
      expect(decodeEffect(false)).toBe(false)
    })

    test("builtin server with no extensions passes", () => {
      const input = { typescript: { command: ["typescript-language-server", "--stdio"] } }
      expect(decodeEffect(input)).toEqual(input)
    })

    test("custom server WITH extensions passes", () => {
      const input = {
        "my-lsp": { command: ["my-lsp-bin"], extensions: [".ml"] },
      }
      expect(decodeEffect(input)).toEqual(input)
    })

    test("disabled custom server passes (no extensions needed)", () => {
      const input = { "my-lsp": { disabled: true as const } }
      expect(decodeEffect(input)).toEqual(input)
    })

    test("mix of builtin and custom with extensions passes", () => {
      const input = {
        typescript: { command: ["typescript-language-server", "--stdio"] },
        "my-lsp": { command: ["my-lsp-bin"], extensions: [".ml"] },
      }
      expect(decodeEffect(input)).toEqual(input)
    })
  })

  describe("rejected inputs", () => {
    const expectedMessage = "For custom LSP servers, 'extensions' array is required."

    test("custom server WITHOUT extensions fails via Effect decode", () => {
      expect(() => decodeEffect({ "my-lsp": { command: ["my-lsp-bin"] } })).toThrow(expectedMessage)
    })

    test("custom server with empty extensions array fails (extensions must be non-empty-truthy)", () => {
      const input = { "my-lsp": { command: ["my-lsp-bin"], extensions: [] } }
      expect(decodeEffect(input)).toEqual(input)
    })

    test("custom server without extensions mixed with a valid builtin still fails", () => {
      const input = {
        typescript: { command: ["typescript-language-server", "--stdio"] },
        "my-lsp": { command: ["my-lsp-bin"] },
      }
      expect(() => decodeEffect(input)).toThrow(expectedMessage)
    })
  })
})
