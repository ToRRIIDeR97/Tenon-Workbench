import { createHash } from "crypto"
import path from "path"
import { Context, Duration, Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { makeGlobalNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { which } from "../util/which"
import { archiveFolder, archiveName, archiveURL, PLATFORM, type Config } from "./release"

export namespace RipgrepBinary {
  // The archives are about 2 MB, so this only trips on a stalled connection.
  const DOWNLOAD_TIMEOUT = "2 minutes"

  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@tenon/RipgrepBinary") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const spawner = yield* ChildProcessSpawner

      const run = Effect.fnUntraced(function* (command: string, args: string[]) {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore" }))
        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )
        return { stdout, stderr, code }
      }, Effect.scoped)

      const extract = Effect.fnUntraced(function* (archive: string, config: Config, target: string) {
        const dir = yield* fs.makeTempDirectoryScoped({ directory: Global.Path.bin, prefix: "ripgrep-" })

        if (config.extension === "zip") {
          const shell = (yield* Effect.sync(() => which("powershell.exe") ?? which("pwsh.exe"))) ?? "powershell.exe"
          const result = yield* run(shell, [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${dir.replaceAll("'", "''")}' -Force`,
          ])
          if (result.code !== 0)
            throw new Error(
              result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
            )
        }

        if (config.extension === "tar.gz") {
          const result = yield* run("tar", ["-xzf", archive, "-C", dir])
          if (result.code !== 0)
            throw new Error(
              result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
            )
        }

        const extracted = path.join(dir, archiveFolder(config), process.platform === "win32" ? "rg.exe" : "rg")
        if (!(yield* fs.isFile(extracted))) throw new Error(`ripgrep archive did not contain executable: ${extracted}`)

        if (process.platform !== "win32") yield* fs.chmod(extracted, 0o755)
        // The temp folder sits beside the target, so this rename is atomic: an existing file at the
        // target is always complete, which is why the lookup below can trust it.
        yield* fs.rename(extracted, target)
      }, Effect.scoped)

      const [filepath, invalidate] = yield* Effect.cachedInvalidateWithTTL(
        Effect.gen(function* () {
          const system = yield* Effect.sync(() => which(process.platform === "win32" ? "rg.exe" : "rg"))
          if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

          // The desktop app ships its own copy, so search works without a download.
          const bundled = process.env.TENON_RIPGREP_PATH
          if (bundled && (yield* fs.isFile(bundled).pipe(Effect.orDie))) return bundled

          const target = path.join(Global.Path.bin, `rg${process.platform === "win32" ? ".exe" : ""}`)
          if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

          const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
          const config = PLATFORM[platformKey]
          if (!config) throw new Error(`unsupported platform for ripgrep: ${platformKey}`)

          const url = archiveURL(config)
          const archive = path.join(Global.Path.bin, archiveName(config))

          yield* Effect.logInfo("downloading ripgrep", { url })
          yield* fs.ensureDir(Global.Path.bin).pipe(Effect.orDie)
          const bytes = yield* HttpClientRequest.get(url).pipe(
            http.execute,
            Effect.flatMap((response) => response.arrayBuffer),
            Effect.timeout(DOWNLOAD_TIMEOUT),
            Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
          )
          if (bytes.byteLength === 0) throw new Error(`failed to download ripgrep from ${url}`)
          const digest = createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
          if (digest !== config.sha256) return yield* Effect.fail(new Error(`ripgrep checksum mismatch for ${url}`))

          yield* fs.writeWithDirs(archive, new Uint8Array(bytes))
          yield* extract(archive, config, target)
          yield* fs.remove(archive, { force: true }).pipe(Effect.ignore)
          return target
        }),
        Duration.infinity,
      )

      // Concurrent callers share one attempt; a failed one is forgotten, so the next search retries.
      return Service.of({ filepath: filepath.pipe(Effect.onError(() => invalidate)) })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node, httpClient, CrossSpawnSpawner.node],
  })
}
