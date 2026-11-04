import { describe, expect, test } from "bun:test"
import type { ContentPart } from "@/context/prompt"
import { createDraftStore } from "@/utils/draft-store"
import { createPromptAttachmentsCore } from "./attachments"
import { pickAttachmentFiles } from "./files"

describe("pickAttachmentFiles", () => {
  test("reads the current project directory for every native picker invocation", async () => {
    const paths: string[] = []
    const files: File[] = []
    const file = new File(["hello"], "hello.txt", { type: "text/plain" })
    let directory = "C:\\Projects\\LoremIpsum"
    const picker = async (options?: { defaultPath?: string }, onFile?: (file: File) => Promise<unknown>) => {
      paths.push(options?.defaultPath ?? "")
      await onFile?.(file)
    }

    pickAttachmentFiles({
      picker,
      directory: () => directory,
      fallback: () => undefined,
      onFile: async (selected) => files.push(selected),
      onError: () => undefined,
    })
    await Promise.resolve()
    directory = "C:\\Projects\\DolorSit"
    pickAttachmentFiles({
      picker,
      directory: () => directory,
      fallback: () => undefined,
      onFile: async (selected) => files.push(selected),
      onError: () => undefined,
    })
    await Promise.resolve()
    expect(files).toEqual([file, file])
    expect(paths).toEqual(["C:\\Projects\\LoremIpsum", "C:\\Projects\\DolorSit"])
  })

  test("uses the browser file input when no native picker exists", async () => {
    let fallback = 0
    pickAttachmentFiles({
      directory: () => "/projects/consectetur-adipiscing",
      fallback: () => {
        fallback += 1
      },
      onFile: async () => undefined,
      onError: () => undefined,
    })
    expect(fallback).toBe(1)
  })

  test("reports native picker failures without rejecting", async () => {
    const error = new Error("picker unavailable")
    const errors: unknown[] = []
    const handled = Promise.withResolvers<void>()
    pickAttachmentFiles({
      picker: async () => Promise.reject(error),
      directory: () => "C:\\Projects\\LoremIpsum",
      fallback: () => undefined,
      onFile: async () => undefined,
      onError: (cause) => {
        errors.push(cause)
        handled.resolve()
      },
    })
    await handled.promise
    expect(errors).toEqual([error])
  })
})

describe("createPromptAttachmentsCore", () => {
  test("keeps an attachment the draft store refuses", async () => {
    let parts: ContentPart[] = []
    const draftStore = createDraftStore({
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      putBlob: () => Promise.reject(new Error("Draft blob too large")),
      getBlob: async () => null,
    })
    const core = createPromptAttachmentsCore({
      capture: () => ({ current: () => parts, cursor: () => 0, set: (next) => (parts = next) }),
      editor: () => document.createElement("div"),
      draftStore,
    })
    const file = new File(["hello"], "hello.txt", { type: "text/plain" })

    expect(await core.addAttachment(file)).toBe(true)
    expect(parts).toHaveLength(1)
    const part = parts[0]
    expect(part?.type === "image" && part.blob.url.startsWith("blob:")).toBe(true)
  })
})
