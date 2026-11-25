import { test, type TestOptions } from "bun:test"
import { FSUtil } from "@tenon/core/fs-util"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { AppProcess } from "@tenon/core/process"
import { Deferred, Duration, Effect, Layer, Schedule, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import path from "node:path"
import { TestLLMServer } from "./llm-server"
import { testProviderConfig } from "./test-provider"
import { it } from "./effect"

const opencodeRoot = path.resolve(import.meta.dir, "../../")
const cliEntry = path.join(opencodeRoot, "src/index.ts")

function fromBunStream(name: string, get: () => ReadableStream<Uint8Array>) {
  return Stream.fromReadableStream({
    evaluate: get,
    onError: (cause) => new Error(`${name} stream error: ${String(cause)}`),
  })
}

function forkStderrDrain(stream: ReadableStream<Uint8Array>, into: string[]) {
  return Effect.forkScoped(
    fromBunStream("stderr", () => stream).pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Effect.sync(() => into.push(chunk))),
      Effect.ignore({ log: true }),
    ),
  )
}

function isolatedEnv(home: string, configJson: string): Record<string, string> {
  return {
    TENON_TEST_HOME: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    TENON_CONFIG_CONTENT: configJson,
    TENON_DISABLE_PROJECT_CONFIG: "1",
    TENON_PURE: "1",
    TENON_DISABLE_AUTOUPDATE: "1",
    TENON_DISABLE_AUTOCOMPACT: "1",
    TENON_DISABLE_MODELS_FETCH: "1",
    TENON_AUTH_CONTENT: "{}",
  }
}

export type RunResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export type SpawnOpts = { readonly timeoutMs?: number; readonly env?: Record<string, string> }

export type ServeOpts = SpawnOpts & {
  readonly port?: number
  readonly hostname?: string
  readonly extraArgs?: string[]
  readonly readyTimeoutMs?: number
}

export type ServeHandle = {
  readonly url: string
  readonly hostname: string
  readonly port: number
  readonly kill: () => void
  readonly exited: Promise<number>
}

export type OpencodeCli = {
  readonly serve: (opts?: ServeOpts) => Effect.Effect<ServeHandle, Error, Scope.Scope>
  readonly spawn: (args: string[], opts?: SpawnOpts) => Effect.Effect<RunResult>
  readonly expectExit: (result: RunResult, expected: number, label?: string) => void
}

export type CliFixture = {
  readonly llm: TestLLMServer["Service"]
  readonly home: string
  readonly opencode: OpencodeCli
}

export function withCliFixture<A, E>(
  fn: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
): Effect.Effect<A, E | unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const fs = yield* FSUtil.Service
    const appProc = yield* AppProcess.Service

    const home = yield* fs.makeTempDirectory({ prefix: "oc-cli-" })
    yield* Effect.addFinalizer(() =>
      fs
        .remove(home, { recursive: true })
        .pipe(Effect.retry(Schedule.max([Schedule.spaced("50 millis"), Schedule.recurs(20)])), Effect.ignore),
    )

    const configJson = JSON.stringify(testProviderConfig(llm.url))
    const env = isolatedEnv(home, configJson)

    const spawn = Effect.fn("opencode.spawn")(function* (args: string[], opts?: SpawnOpts) {
      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? 30_000
      const command = ChildProcess.make(process.execPath, ["run", "--conditions=browser", cliEntry, ...args], {
        cwd: home,
        env: { ...env, ...opts?.env },
        extendEnv: true,
        stdin: "ignore",
      })
      const result = yield* appProc.run(command, { timeout: Duration.millis(timeoutMs) }).pipe(
        Effect.catchTag("AppProcessError", (err) =>
          Effect.succeed({
            command: err.command,
            exitCode: err.exitCode ?? -1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from((err.stderr ?? String(err.cause ?? err.message)) + "\n"),
            stdoutTruncated: false,
            stderrTruncated: false,
          } satisfies AppProcess.RunResult),
        ),
      )
      return {
        exitCode: result.exitCode,
        stdout: normalizeLines(result.stdout.toString()),
        stderr: normalizeLines(result.stderr.toString()),
        durationMs: Date.now() - start,
      }
    })

    const serve = Effect.fn("opencode.serve")(function* (opts?: ServeOpts) {
      const argv = ["serve"]
      argv.push("--port", String(opts?.port ?? 0))
      if (opts?.hostname) argv.push("--hostname", opts.hostname)
      if (opts?.extraArgs) argv.push(...opts.extraArgs)

      const proc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([process.execPath, "run", "--conditions=browser", cliEntry, ...argv], {
            cwd: home,
            env: { ...process.env, ...env, ...opts?.env },
            stdout: "pipe",
            stderr: "pipe",
          }),
        ),
        (p) =>
          Effect.promise(() => {
            p.kill()
            return p.exited
          }).pipe(Effect.ignore),
      )

      const stderrChunks: string[] = []
      yield* forkStderrDrain(proc.stderr, stderrChunks)

      const readyRe = /listening on (http:\/\/([^\s:]+):(\d+))/
      const readyDeferred = yield* Deferred.make<{ url: string; hostname: string; port: number }>()
      yield* Effect.forkScoped(
        fromBunStream("stdout", () => proc.stdout).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => {
            const m = line.match(readyRe)
            return m ? Deferred.succeed(readyDeferred, { url: m[1], hostname: m[2], port: Number(m[3]) }) : Effect.void
          }),
          Effect.ignore({ log: true }),
        ),
      )

      const readyTimeoutMs = opts?.readyTimeoutMs ?? 15_000
      const match = yield* Deferred.await(readyDeferred).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(readyTimeoutMs),
          orElse: () =>
            Effect.fail(
              new Error(
                `opencode serve did not become ready within ${readyTimeoutMs}ms\n` +
                  `stderr (last 2000):\n${stderrChunks.join("").slice(-2000)}`,
              ),
            ),
        }),
      )

      return {
        url: match.url,
        hostname: match.hostname,
        port: match.port,
        kill: () => {
          proc.kill()
        },
        exited: proc.exited as Promise<number>,
      } satisfies ServeHandle
    })

    const opencode: OpencodeCli = { serve, spawn, expectExit }

    return yield* fn({ llm, home, opencode })
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        TestLLMServer.layer,
        FetchHttpClient.layer,
        AppNodeBuilder.build(LayerNode.group([FSUtil.node, AppProcess.node])),
      ),
    ),
  )
}

function normalizeLines(value: string) {
  return value.replaceAll("\r\n", "\n")
}

function expectExit(result: RunResult, expected: number, label = "opencode") {
  if (result.exitCode === expected) return
  const tail = (s: string, n: number) => (s.length > n ? "..." + s.slice(-n) : s)
  // eslint-disable-next-line no-console
  console.error(`[${label}] expected exit ${expected}, got ${result.exitCode} after ${result.durationMs}ms`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stderr (last 2000):\n${tail(result.stderr, 2000)}`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stdout (last 500):\n${tail(result.stdout, 500)}`)
  throw new Error(`${label}: expected exit ${expected}, got ${result.exitCode}`)
}

export const cliIt = {
  live: <A, E>(
    name: string,
    body: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
    opts?: number | TestOptions,
  ) => it.live(name, () => withCliFixture(body), opts),
  concurrent: <A, E>(
    name: string,
    body: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
    opts?: number | TestOptions,
  ) =>
    (process.platform === "win32" ? test : test.concurrent)(
      name,
      () => Effect.runPromise(Effect.scoped(withCliFixture(body))),
      opts,
    ),
}
