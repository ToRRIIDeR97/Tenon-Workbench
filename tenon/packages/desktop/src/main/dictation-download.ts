import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { dictationModelURL, type DictationModel } from "./dictation-models"

export type DictationDownloadCode = "cancelled" | "checksum" | "disk_space" | "network" | "server"

export class DictationDownloadError extends Error {
  constructor(
    readonly code: DictationDownloadCode,
    message: string,
  ) {
    super(message)
    this.name = "DictationDownloadError"
  }
}

type DownloadInput = {
  model: DictationModel
  target: string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  signal: AbortSignal
  onProgress: (received: number) => void
}

/**
 * Streams the model to a `.part` file, checks its size and SHA-256, then moves it into place. A
 * dropped connection keeps the `.part` and the next attempt resumes it with a Range request; a server
 * that ignores the Range starts over. Cancelling removes it, since the download wasn't wanted.
 */
export async function downloadModel(input: DownloadInput) {
  await transfer(input).catch(async (error: unknown) => {
    if (input.signal.aborted) {
      await rm(`${input.target}.part`, { force: true, maxRetries: 3 }).catch(() => undefined)
      throw new DictationDownloadError("cancelled", "The model download was cancelled")
    }
    if (error instanceof DictationDownloadError) throw error
    const disk = (error as NodeJS.ErrnoException).code === "ENOSPC"
    throw new DictationDownloadError(disk ? "disk_space" : "network", "The model download did not finish")
  })
}

async function transfer(input: DownloadInput) {
  const model = input.model
  const partial = `${input.target}.part`
  await mkdir(dirname(partial), { recursive: true })
  let have = await stat(partial).then(
    (info) => info.size,
    () => 0,
  )
  if (have >= model.size) {
    await rm(partial, { force: true })
    have = 0
  }
  // Network drives may not report free space; the write then fails with ENOSPC instead.
  const free = await statfs(dirname(partial)).then(
    (info) => info.bavail * info.bsize,
    () => Infinity,
  )
  if (free < model.size - have) throw new DictationDownloadError("disk_space", "Not enough disk space for the model")

  const response = await input.fetch(dictationModelURL(model), {
    signal: input.signal,
    headers: have ? { Range: `bytes=${have}-` } : {},
  })
  const ranged = response.status === 206
  if (response.status === 416 || (ranged && !response.headers.get("content-range")?.startsWith(`bytes ${have}-`))) {
    await rm(partial, { force: true })
    throw new DictationDownloadError("server", `Model download could not resume (${response.status})`)
  }
  if (!response.ok || !response.body)
    throw new DictationDownloadError("server", `Model download failed (${response.status})`)
  if (!ranged) have = 0

  const hash = createHash("sha256")
  if (have) for await (const chunk of createReadStream(partial)) hash.update(chunk as Buffer)
  let received = have
  let reported = have
  input.onProgress(received)
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>)
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk)
    received += chunk.length
    if (received - reported < 1_000_000 && received < model.size) return
    reported = received
    input.onProgress(received)
  })
  await pipeline(body, createWriteStream(partial, { flags: have ? "a" : "w" }), { signal: input.signal })

  const size = (await stat(partial)).size
  if (size < model.size) throw new DictationDownloadError("network", "The model download ended early")
  if (size !== model.size || hash.digest("hex") !== model.sha256) {
    await rm(partial, { force: true })
    throw new DictationDownloadError("checksum", "The downloaded model did not match its checksum")
  }
  await rename(partial, input.target)
}
