export * as HarnessCatalogCache from "./catalog-cache"

import fs from "fs/promises"
import path from "path"
import { Effect, Option, Schema, Semaphore } from "effect"
import { Harness } from "@tenon/schema/harness"
import { Hash } from "../util/hash"

export const fileName = "harness-models.v3.json"
export const probeFileName = "harness-probes.json"

const Entry = Schema.Struct({ models: Schema.Array(Harness.Model), checked: Schema.Number })
export type Entry = typeof Entry.Type
const decodeEntries = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Entry)))
const decodeProbes = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Harness.Instance)))
const writeLock = Semaphore.makeUnsafe(1)

export const id = (instanceKey: string) => Hash.sha256(instanceKey)

export const read = (dataDir: string) => readFile(dataDir, fileName, decodeEntries)

export const write = (dataDir: string, instanceKey: string, entry: Entry) =>
  writeEntry(dataDir, fileName, decodeEntries, instanceKey, entry)

export const readProbes = (dataDir: string) => readFile(dataDir, probeFileName, decodeProbes)

export const writeProbe = (dataDir: string, instanceKey: string, instance: Harness.Instance) => {
  const { error: _error, ...kept } = instance
  return writeEntry(dataDir, probeFileName, decodeProbes, instanceKey, kept)
}

type Decode<A> = (text: string) => Option.Option<Readonly<Record<string, A>>>

function readFile<A>(dataDir: string, name: string, decode: Decode<A>): Effect.Effect<Readonly<Record<string, A>>> {
  return Effect.promise(async () =>
    Option.getOrElse(decode(await fs.readFile(path.join(dataDir, name), "utf8").catch(() => "")), () => ({})),
  )
}

function writeEntry<A>(dataDir: string, name: string, decode: Decode<A>, instanceKey: string, entry: A) {
  return readFile(dataDir, name, decode).pipe(
    Effect.flatMap((current) =>
      Effect.promise(async () => {
        const file = path.join(dataDir, name)
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`
        await fs.mkdir(dataDir, { recursive: true })
        await fs
          .writeFile(temp, JSON.stringify({ ...current, [id(instanceKey)]: entry }))
          .then(() => fs.rename(temp, file))
          .catch(() => fs.rm(temp, { force: true }))
      }),
    ),
    writeLock.withPermits(1),
  )
}
