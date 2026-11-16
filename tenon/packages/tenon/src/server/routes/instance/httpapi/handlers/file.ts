import * as InstanceState from "@/effect/instance-state"
import { FileSystem } from "@tenon/core/filesystem"
import { LocationServiceMap, locationServiceMapLayer } from "@tenon/core/location-services"
import { Ripgrep } from "@tenon/core/ripgrep"
import { FSUtil } from "@tenon/core/fs-util"
import { FileMutation } from "@tenon/core/file-mutation"
import { Location } from "@tenon/core/location"
import { AbsolutePath, RelativePath } from "@tenon/core/schema"
import { Effect, Layer, Option } from "effect"
import ignore from "ignore"
import path from "path"
import { createHash } from "crypto"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { InstanceHttpApi } from "../api"
import { FileConflictError, FileInvalidError } from "../groups/file"

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
const invalid = (message: string) => new FileInvalidError({ name: "FileInvalidError", data: { message } })

/**
 * The file's text, or `undefined` for a binary file. A UTF-8 byte-order mark stays as a leading U+FEFF,
 * which `trim()` removes, so the trimmed text (and its hash) is the content route's, and the mark is
 * written back with the leading whitespace.
 */
const decodeText = (bytes: Uint8Array) =>
  bytes.includes(0)
    ? Effect.succeed(undefined)
    : Effect.sync(() => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)).pipe(
        Effect.catchDefect(() => Effect.succeed(undefined)),
      )

/** `content` (trimmed) between the leading and trailing whitespace of `current`. */
export const withOuterWhitespace = (current: string, content: string) => {
  if (!current.trim()) return current + content.trim()
  const leading = current.slice(0, current.length - current.trimStart().length)
  const trailing = current.slice(current.trimEnd().length)
  return leading + content.trim() + trailing
}

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const locations = yield* LocationServiceMap.Service

    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .grep({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).map((match) => ({
        path: { text: match.entry.path },
        lines: { text: match.text },
        line_number: match.line,
        absolute_offset: match.offset,
        submatches: match.submatches.map((submatch) => ({
          match: { text: submatch.text },
          start: submatch.start,
          end: submatch.end,
        })),
      }))
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      const directory = (yield* InstanceState.context).directory
      const limit = ctx.query.limit ?? 10
      const type = ctx.query.type ?? (ctx.query.dirs === "false" ? "file" : undefined)
      const started = performance.now()
      const found = yield* filesystem(FileSystem.Service.use((fs) => fs.find({ query: ctx.query.query, limit, type })))
      yield* Effect.logInfo("find file", {
        query: ctx.query.query,
        type,
        directory,
        limit,
        results: found.length,
        duration: Math.round(performance.now() - started),
      })
      return found.map((item) => item.path)
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      return yield* filesystem(
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const raw = yield* FSUtil.Service
          const location = yield* Location.Service
          const ignored = ignore()
          const gitignore = yield* raw
            .readFileString(path.join(location.project.directory, ".gitignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignore) ignored.add(gitignore)
          const ignorefile = yield* raw
            .readFileString(path.join(location.project.directory, ".ignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (ignorefile) ignored.add(ignorefile)
          return (yield* fs.list({ path: RelativePath.make(ctx.query.path) })).map((item) => ({
            name: path.basename(item.path),
            path: item.path,
            absolute: path.resolve(location.directory, item.path),
            type: item.type,
            ignored: ignored.ignores(
              path.relative(location.project.directory, path.resolve(location.directory, item.path)) +
                (item.type === "directory" ? "/" : ""),
            ),
          }))
        }),
      )
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.query.path)
      if (!FSUtil.contains(directory, file)) return yield* Effect.die(new Error("Path escapes the location"))
      if (!(yield* FSUtil.Service.use((fs) => fs.existsSafe(file)))) return { type: "text" as const, content: "" }
      return yield* filesystem(
        FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(ctx.query.path) })),
      ).pipe(
        Effect.flatMap((item) =>
          Effect.gen(function* () {
            const text = item.content.includes(0)
              ? Option.none<string>()
              : yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(item.content)).pipe(
                  Effect.option,
                )
            return { item, text }
          }),
        ),
        Effect.map(({ item, text }) =>
          Option.isSome(text)
            ? { type: "text" as const, content: text.value.trim() }
            : {
                type: "binary" as const,
                content: Buffer.from(item.content).toString("base64"),
                encoding: "base64" as const,
                mimeType: item.mime,
              },
        ),
      )
    })

    // Writes back only an existing text file inside the folder, also after resolving symlinks, and only
    // when the caller saw its current text (the hash precondition). Nothing is created or removed.
    const write = Effect.fn("FileHttpApi.write")(function* (ctx: {
      payload: { path: string; content: string; expectedHash: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.payload.path)
      if (!FSUtil.contains(directory, file)) return yield* invalid("path_outside_folder")
      const fs = yield* FSUtil.Service
      const real = yield* fs.realPath(file).pipe(Effect.option)
      if (Option.isNone(real)) return yield* new HttpApiError.NotFound({})
      const root = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => directory))
      if (!FSUtil.contains(root, real.value)) return yield* invalid("path_outside_folder")
      const info = yield* fs.stat(real.value).pipe(Effect.option)
      if (Option.isNone(info)) return yield* new HttpApiError.NotFound({})
      if (info.value.type !== "File") return yield* invalid("not_a_file")
      const bytes = yield* fs.readFile(real.value).pipe(Effect.option)
      if (Option.isNone(bytes)) return yield* new HttpApiError.NotFound({})
      const current = yield* decodeText(bytes.value)
      if (current === undefined) return yield* invalid("binary_file")
      const currentHash = sha256(current.trim())
      if (currentHash !== ctx.payload.expectedHash)
        return yield* new FileConflictError({ name: "FileConflictError", currentHash })
      // Atomic (synced temp file and rename) and only if the bytes are still the ones just compared.
      const stale = yield* filesystem(
        FileMutation.Service.use((files) =>
          files.writeIfUnchanged({
            target: { canonical: real.value, resource: path.relative(root, real.value) },
            content: withOuterWhitespace(current, ctx.payload.content),
            expected: bytes.value,
          }),
        ),
      ).pipe(
        Effect.as(false),
        Effect.catchTag("FileMutation.StaleContentError", () => Effect.succeed(true)),
        Effect.orDie,
      )
      if (stale) {
        const now = yield* fs.readFile(real.value).pipe(Effect.flatMap(decodeText), Effect.orDie)
        return yield* new FileConflictError({ name: "FileConflictError", currentHash: sha256((now ?? "").trim()) })
      }
      return { hash: sha256(ctx.payload.content.trim()) }
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return []
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("write", write)
      .handle("status", status)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
