export * as AcpHarness from "./acp"

import { LLMError, LLMEvent, TransportReason, type FinishReason } from "@tenon/llm"
import { Harness } from "@tenon/schema/harness"
import { Clock, Deferred, Effect, Exit, Option, Queue, Schema, Scope, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/process"
import os from "os"
import path from "path"
import { ConfigHarness } from "../config/harness"
import type { AppProcess } from "../process"
import type { QuestionV2 } from "../question"
import { harnessEnvironment } from "./env"
import { HarnessPids } from "./pids"
import {
  make as makeClient,
  ProtocolError,
  watchExit,
  type Client,
  type Notification,
  type ServerRequest,
} from "./codex-app-server"

export const protocolVersion = 1

export interface Settings {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
  readonly models: ReadonlyArray<string>
}

export interface PermissionRequest {
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly title: string
  readonly kind?: string
  readonly callID?: string
}

export interface OpenInput {
  readonly settings: Settings
  readonly directory: string
  readonly continuation?: string
  readonly mcpServers?: ReadonlyArray<McpServer>
  readonly approve: (request: PermissionRequest) => Effect.Effect<boolean>
  readonly ask?: (
    questions: ReadonlyArray<QuestionV2.Prompt>,
  ) => Effect.Effect<ReadonlyArray<QuestionV2.Answer> | undefined>
  readonly onCommands?: (commands: ReadonlyArray<AcpCommand>) => Effect.Effect<void>
}

export interface AcpCommand {
  readonly name: string
  readonly description?: string
}

export interface Session {
  readonly sessionId: string
  readonly resumed: boolean
  readonly mcpAttached: boolean
  readonly agent: { readonly name?: string; readonly version?: string }
  readonly capabilities: ReturnType<typeof agentCapabilities>
  readonly models: ReadonlyArray<Harness.Model>
  readonly closed: Effect.Effect<boolean>
  readonly backgroundWorking: () => boolean
  readonly turn: (input: {
    readonly text: string
    readonly media?: ReadonlyArray<Media>
    readonly model?: string
    readonly reasoningEffort?: string
    readonly steer?: Effect.Effect<void>
    readonly watch?: { readonly name: string; readonly waiting: () => boolean }
  }) => Stream.Stream<LLMEvent, LLMError>
}

export const stopOnSteer = <A, E>(
  events: Stream.Stream<A, E>,
  steer: Effect.Effect<void> | undefined,
  stop: Effect.Effect<unknown, unknown>,
) =>
  steer
    ? events.pipe(
        Stream.merge(Stream.fromEffectDrain(steer.pipe(Effect.andThen(stop), Effect.ignore)), { haltStrategy: "left" }),
      )
    : events

export const SILENCE_LIMIT_MINUTES = 10
const SILENCE_LIMIT = SILENCE_LIMIT_MINUTES * 60_000

export const BACKGROUND_LIMIT = 60 * 60_000

export function backgroundChild(output: string) {
  return /working in the background \(sessionID: ([^)\s]+)\)/.exec(output)?.[1]
}

export function backgroundWorking(children: ReadonlyMap<string, number>, now: number) {
  return [...children.values()].some((started) => now - started < BACKGROUND_LIMIT)
}

export const failOnSilence = <A, E>(
  build: (heard: Effect.Effect<void>) => Stream.Stream<A, E>,
  busy: () => boolean,
  failure: E,
) =>
  Stream.unwrap(
    Clock.currentTimeMillis.pipe(
      Effect.map((started) => {
        const state = { last: started }
        const heard = Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            state.last = now
          }),
        )
        const silent = Effect.sleep("30 seconds").pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.map((now) => {
            if (busy()) state.last = now
            return now - state.last >= SILENCE_LIMIT
          }),
          Effect.repeat({ until: (stopped) => stopped }),
          Effect.andThen(Effect.fail(failure)),
        )
        return build(heard).pipe(Stream.merge(Stream.fromEffectDrain(silent), { haltStrategy: "left" }))
      }),
    ),
  )

export interface Media {
  readonly mediaType: string
  readonly data: string
  readonly filename?: string
}

export function acpPromptBlocks(text: string, media: ReadonlyArray<Media>, capabilities: { readonly image?: boolean }) {
  return [
    { type: "text", text },
    ...media.flatMap((item): Record<string, unknown>[] => {
      if (item.data.startsWith("file://"))
        return [
          {
            type: "resource_link",
            uri: item.data,
            name: item.filename ?? item.data.split("/").pop() ?? "file",
            mimeType: item.mediaType,
          },
        ]
      const inline = /^data:(image\/[^;,]+);base64,(.*)$/s.exec(item.data)
      return inline && capabilities.image === true ? [{ type: "image", mimeType: inline[1], data: inline[2] }] : []
    }),
  ]
}

export function safeAcpMode(modes: unknown) {
  if (!isRecord(modes) || modes.currentModeId === "default" || modes.currentModeId === "plan") return undefined
  if (typeof modes.currentModeId !== "string") return undefined
  const available = Array.isArray(modes.availableModes) ? modes.availableModes : []
  return available.some((mode) => isRecord(mode) && mode.id === "default") ? "default" : undefined
}

type Process = Pick<AppProcess.Interface, "spawn">

type Item =
  | { readonly type: "update"; readonly notification: Notification }
  | { readonly type: "done"; readonly exit: Exit.Exit<unknown, ProtocolError> }

const decodeAcp = Schema.decodeUnknownOption(ConfigHarness.Acp)

export function decodeSettings(config: Readonly<Record<string, unknown>>): Settings | undefined {
  const decoded = Option.getOrUndefined(decodeAcp(config))
  const command = decoded?.command.trim()
  if (!decoded || !command) return undefined
  return {
    command: expandHome(command),
    args: decoded.args ?? [],
    env: decoded.env ?? {},
    models: decoded.models ?? [],
  }
}

function connect(
  process: Process,
  settings: Settings,
  directory: string,
  options: {
    readonly handleRequest?: (request: ServerRequest) => Effect.Effect<unknown, ProtocolError>
    readonly onNotification?: (notification: Notification) => Effect.Effect<void>
    readonly elicitation?: boolean
  } = {},
) {
  return Effect.gen(function* () {
    const handle = yield* process
      .spawn(
        ChildProcess.make(settings.command, [...settings.args], {
          cwd: directory,
          env: harnessEnvironment(settings.env),
          extendEnv: false,
          forceKillAfter: "2 seconds",
          stdin: { stream: "pipe", endOnDone: false },
        }),
      )
      .pipe(Effect.mapError((cause) => startError(settings.command, cause)))
    yield* HarnessPids.track(handle.pid, settings.command)
    const exit = yield* watchExit(handle)
    const client = yield* makeClient({
      connection: { stdout: handle.stdout, stdin: handle.stdin },
      jsonrpc: true,
      label: "ACP agent",
      exit,
      handleRequest: options.handleRequest ?? ((request) => Effect.fail(unsupported(request.method))),
      onNotification: options.onNotification ?? (() => Effect.void),
    })
    const initialize = yield* client.request("initialize", {
      protocolVersion,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        ...(options.elicitation ? { elicitation: { form: {} } } : {}),
      },
      clientInfo: { name: "second_brain_os", title: "Tenon Workbench", version: "0.1.0" },
    })
    const info = isRecord(initialize) ? initialize : {}
    if (info.protocolVersion !== protocolVersion)
      return yield* Effect.fail(
        new ProtocolError(`Unsupported ACP protocol version: ${json(info.protocolVersion ?? "missing")}.`),
      )
    return { client, initialize: info }
  })
}

export function startError(command: string, cause: PlatformError) {
  const reason = cause.reason._tag
  if (reason === "NotFound")
    return new ProtocolError(`${command} isn't installed or isn't on PATH. Set it up in Settings → Harnesses.`, {
      cause,
    })
  if (reason === "PermissionDenied")
    return new ProtocolError(`Tenon isn't allowed to run ${command}. Check that file's permissions.`, { cause })
  return new ProtocolError(`Could not start ${command}.`, { cause })
}

export function agentCapabilities(initialize: Record<string, unknown>) {
  const capabilities = isRecord(initialize.agentCapabilities) ? initialize.agentCapabilities : {}
  const mcp = isRecord(capabilities.mcpCapabilities) ? capabilities.mcpCapabilities : {}
  const prompt = isRecord(capabilities.promptCapabilities) ? capabilities.promptCapabilities : {}
  return {
    mcpHttp: mcp.http === true,
    image: prompt.image === true,
    loadSession: capabilities.loadSession === true,
  }
}

export function agentInfo(initialize: Record<string, unknown>) {
  const agent = isRecord(initialize.agentInfo) ? initialize.agentInfo : undefined
  return { name: string(agent?.title) ?? string(agent?.name), version: string(agent?.version) }
}

export const handshake = (process: Process, settings: Settings, directory: string) =>
  Effect.scoped(connect(process, settings, directory)).pipe(
    Effect.timeoutOrElse({
      duration: "8 seconds",
      orElse: () =>
        Effect.fail(new ProtocolError("The ACP agent did not answer initialize within 8 seconds.", { timedOut: true })),
    }),
    Effect.map(({ initialize }) => agentInfo(initialize)),
  )

export const discover = (process: Process, settings: Settings, directory: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { client, initialize } = yield* connect(process, settings, directory)
      const session = yield* createSession(client, { cwd: directory, mcpServers: [] })
      const selector = sessionModels(session.response)
      const configId = selector.configId
      const levels = (effort: EffortOption | undefined) =>
        (effort?.values ?? []).filter((value) => value !== EFFORT_DEFAULT)
      const models = configId
        ? yield* Effect.forEach(selector.models, (model) =>
            model.isDefault
              ? Effect.succeed(model)
              : client
                  .request("session/set_config_option", { sessionId: session.sessionId, configId, value: model.id })
                  .pipe(
                    Effect.map((response) => levels(sessionModels(response).effort)),
                    Effect.catch(() => Effect.succeed(levels(selector.effort))),
                    Effect.map((reasoningEfforts) => Harness.Model.make({ ...model, reasoningEfforts })),
                  ),
          )
        : selector.models
      return { ...agentInfo(initialize), models }
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "45 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not list its models within 45 seconds.")),
    }),
  )

export const verifyPrompt = "Reply with exactly: harness ok"

export const verify = (process: Process, settings: Settings, directory: string, model?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const session = yield* open(process, { settings, directory, approve: () => Effect.succeed(false) })
      const events = yield* Stream.runCollect(session.turn({ text: verifyPrompt, model }))
      const reply = Array.from(events)
        .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
        .join("")
        .trim()
      return { ...session.agent, capabilities: session.capabilities, models: session.models, reply }
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "120 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not finish the test prompt within 120 seconds.")),
    }),
  )

export function probe(
  process: Process,
  instance: { readonly id: Harness.InstanceID; readonly driver: Harness.DriverKind; readonly name: string },
  settings: Settings,
  directory: string,
  known?: ReadonlyArray<Harness.Model>,
): Effect.Effect<{ readonly instance: Harness.Instance; readonly discovered?: ReadonlyArray<Harness.Model> }> {
  const base = { id: instance.id, driver: instance.driver, name: instance.name }
  return handshake(process, settings, directory).pipe(
    Effect.map((agent) => ({
      instance: Harness.Instance.make({
        ...base,
        status: "available",
        version: agent.version,
        models: withConfigured(known ?? [], settings.models),
      }),
    })),
    Effect.catch((error) =>
      Effect.succeed({ instance: probeFailure(base, error, withConfigured(known ?? [], settings.models)) }),
    ),
  )
}

export function probeFailure(
  base: { readonly id: Harness.InstanceID; readonly driver: Harness.DriverKind; readonly name: string },
  error: unknown,
  models: ReadonlyArray<Harness.Model>,
) {
  const late = error instanceof ProtocolError && error.timedOut === true
  return Harness.Instance.make({
    ...base,
    status: late ? "available" : "unavailable",
    error: errorMessage(error),
    ...(late ? { slowStart: true } : {}),
    models: [...models],
  })
}

export function withConfigured(models: ReadonlyArray<Harness.Model>, configured: ReadonlyArray<string>) {
  return models.length > 0 ? [...models] : configuredModels(configured)
}

export const open = Effect.fn("AcpHarness.open")(function* (
  process: Process & Partial<Pick<AppProcess.Interface, "run">>,
  input: OpenInput,
) {
  const scope = yield* Effect.scope
  const usageLookup = openCodeUsageLookup(process, input.settings, input.directory)
  const messageLookup = openCodeMessageLookup(process, input.settings, input.directory)
  const items = yield* Queue.unbounded<Item>()
  const { client, initialize } = yield* connect(process, input.settings, input.directory, {
    handleRequest: (request) => handleRequest(request, input.approve, input.ask),
    elicitation: input.ask !== undefined,
    onNotification: (notification) => {
      const commands = input.onCommands ? reportedCommands(notification) : undefined
      return (commands ? input.onCommands!(commands) : Effect.void).pipe(
        Effect.andThen(Queue.offer(items, { type: "update", notification })),
        Effect.asVoid,
      )
    },
  }).pipe(
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not answer initialize within 30 seconds.")),
    }),
  )
  const capabilities = isRecord(initialize.agentCapabilities) ? initialize.agentCapabilities : {}
  const http = isRecord(capabilities.mcpCapabilities) && capabilities.mcpCapabilities.http === true
  const promptCapabilities = isRecord(capabilities.promptCapabilities) ? capabilities.promptCapabilities : {}
  const params = {
    cwd: input.directory,
    mcpServers: (input.mcpServers ?? []).filter((server) => http || !("type" in server)),
  }
  const loaded =
    input.continuation && capabilities.loadSession === true
      ? yield* client.request("session/load", { ...params, sessionId: input.continuation }, SESSION_SETUP_TIMEOUT).pipe(
          Effect.map((response) => ({ sessionId: input.continuation!, response })),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      : undefined
  const replayed = yield* Queue.clear(items)
  const baseline = loaded
    ? replayedCost(replayed.flatMap((item) => (item.type === "update" ? [item.notification] : [])))
    : undefined
  const session = loaded ?? (yield* createSession(client, params))
  const mode = safeAcpMode(isRecord(session.response) ? session.response.modes : undefined)
  if (mode)
    yield* client
      .request("session/set_mode", { sessionId: session.sessionId, modeId: mode }, SESSION_SETUP_TIMEOUT)
      .pipe(
        Effect.tap(() => Effect.logInfo("ACP session moved to its asking mode", { mode })),
        Effect.catch((error) =>
          Effect.logWarning("ACP session could not move to its asking mode", { error: error.message }),
        ),
      )
  const selector = sessionModels(session.response)
  const state: {
    currentModel: string | undefined
    effort?: EffortOption
    sessionCost?: number
    prompt?: Deferred.Deferred<void>
    readonly background: Map<string, number>
  } = {
    currentModel: selector.current,
    effort: selector.effort,
    sessionCost: baseline,
    background: new Map(),
  }
  const readEffort = (response: unknown) =>
    Effect.sync(() => {
      if (isRecord(response) && Array.isArray(response.configOptions)) state.effort = sessionModels(response).effort
    })

  const setModel = (model: string | undefined) =>
    !model || model === state.currentModel
      ? Effect.void
      : (selector.configId
          ? client.request(
              "session/set_config_option",
              { sessionId: session.sessionId, configId: selector.configId, value: model },
              SESSION_SETUP_TIMEOUT,
            )
          : client.request("session/set_model", { sessionId: session.sessionId, modelId: model }, SESSION_SETUP_TIMEOUT)
        ).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              state.currentModel = model
            }).pipe(Effect.andThen(readEffort(response))),
          ),
          Effect.asVoid,
        )

  const setEffort = (effort: string | undefined) =>
    Effect.suspend(() => {
      const option = state.effort
      const value = effort ?? (option?.values.includes(EFFORT_DEFAULT) ? EFFORT_DEFAULT : undefined)
      if (!option || !value || value === option.current || !option.values.includes(value)) return Effect.void
      return client
        .request(
          "session/set_config_option",
          { sessionId: session.sessionId, configId: option.configId, value },
          SESSION_SETUP_TIMEOUT,
        )
        .pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              state.effort = { ...option, current: value }
            }).pipe(Effect.andThen(readEffort(response))),
          ),
          Effect.asVoid,
          Effect.catch((error) => (error.timedOut ? Effect.fail(error) : Effect.void)),
        )
    })

  const promptSettled = Effect.suspend(() =>
    state.prompt
      ? Deferred.await(state.prompt).pipe(
          Effect.timeoutOrElse({
            duration: PROMPT_UNWIND_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new ProtocolError("The agent is still stopping its last turn. Send again.", { timedOut: true }),
              ),
          }),
        )
      : Effect.void,
  )

  const turn = (turnInput: {
    readonly text: string
    readonly media?: ReadonlyArray<Media>
    readonly model?: string
    readonly reasoningEffort?: string
    readonly steer?: Effect.Effect<void>
    readonly watch?: { readonly name: string; readonly waiting: () => boolean }
  }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* promptSettled
        const variant = `${turnInput.model}/${turnInput.reasoningEffort}`
        const requested = selector.variants?.has(variant) ? variant : turnInput.model
        const switched = yield* Effect.exit(setModel(requested))
        if (Exit.isFailure(switched)) {
          const error = Option.getOrUndefined(Exit.findErrorOption(switched))
          if (error?.timedOut) return yield* Effect.fail(error)
          return Stream.fromIterable(
            finishAcpTurn(
              Exit.fail(
                new ProtocolError(
                  `The agent couldn't switch to the model ${requested}: ${error?.message ?? "it refused the change"}. Pick another model and send again.`,
                ),
              ),
              acpState(),
            ),
          )
        }
        yield* setEffort(turnInput.reasoningEffort)
        yield* Queue.clear(items)
        const parser = acpState(state.sessionCost)
        const settled = yield* Deferred.make<void>()
        state.prompt = settled
        yield* client
          .request("session/prompt", {
            sessionId: session.sessionId,
            prompt: acpPromptBlocks(turnInput.text, turnInput.media ?? [], promptCapabilities),
          })
          .pipe(
            Effect.onInterrupt(() =>
              Queue.offer(items, { type: "done", exit: Exit.fail(new ProtocolError("ACP agent client closed.")) }),
            ),
            Effect.exit,
            Effect.flatMap((exit) => Queue.offer(items, { type: "done", exit })),
            Effect.ensuring(Deferred.succeed(settled, undefined)),
            Effect.forkIn(scope),
          )
        yield* Scope.addFinalizer(
          scope,
          Effect.suspend(() => {
            if (state.prompt !== settled) return Effect.void
            return Deferred.isDone(settled).pipe(
              Effect.flatMap((done) =>
                done
                  ? Effect.void
                  : client
                      .notify("session/cancel", { sessionId: session.sessionId })
                      .pipe(Effect.andThen(Deferred.await(settled)), Effect.timeout("2 seconds"), Effect.ignore),
              ),
            )
          }),
        )
        const follow = { active: false, leave: yield* Deferred.make<void>(), reported: new Set<string>() }
        const followBackground = (exit: Exit.Exit<unknown, ProtocolError>) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const now = Date.now()
              const out = [
                ...[...parser.tools.values()].flatMap((tool) => (tool.background ? [tool.background] : [])),
                ...[...state.background].flatMap(([child, started]) =>
                  now - started < BACKGROUND_LIMIT ? [child] : [],
                ),
              ]
              const stopReason = Exit.isSuccess(exit) && isRecord(exit.value) ? exit.value.stopReason : undefined
              if (!messageLookup || out.length === 0 || stopReason !== "end_turn") return Stream.empty
              const first = yield* messageLookup(session.sessionId)
              if (!first) return Stream.empty
              follow.active = true
              const pending = new Set(out)
              const seen = new Set(first.map((message) => String(message.id)))
              followProgress(first, new Set(seen), pending)
              const started = Date.now()
              const step = (settled: number | undefined) =>
                Effect.gen(function* () {
                  yield* Effect.sleep(FOLLOW_INTERVAL)
                  const read = yield* messageLookup(session.sessionId)
                  const progress = read ? followProgress(read, seen, pending) : { fresh: [], idle: false }
                  const events = progress.fresh.flatMap((message) =>
                    openCodeMessageUpdates(message).flatMap((update) =>
                      parseAcpNotification(
                        { method: "session/update", params: { sessionId: session.sessionId, update } },
                        session.sessionId,
                        parser,
                      ),
                    ),
                  )
                  const now = Date.now()
                  const quiet = pending.size === 0 ? (progress.fresh.length > 0 ? now : (settled ?? now)) : undefined
                  const over =
                    progress.idle ||
                    (quiet !== undefined && now - quiet >= FOLLOW_SETTLE) ||
                    now - started >= BACKGROUND_LIMIT ||
                    (yield* client.closed)
                  return [events, over ? Option.none() : Option.some(quiet)] as const
                })
              return Stream.paginate<number | undefined, LLMEvent>(undefined, step).pipe(
                Stream.interruptWhen(Deferred.await(follow.leave)),
                Stream.ensuring(
                  Effect.sync(() => {
                    follow.active = false
                    for (const child of out) if (!pending.has(child)) follow.reported.add(child)
                  }),
                ),
              )
            }),
          )
        const body = (heard: Effect.Effect<void>) =>
          Stream.fromQueue(items).pipe(
            Stream.tap(() => heard),
            Stream.takeUntil((item) => item.type === "done"),
            Stream.flatMap((item) => {
              const events = (list: ReadonlyArray<LLMEvent>) =>
                Stream.fromEffect(withSubagentUsage(list, parser, usageLookup)).pipe(
                  Stream.flatMap((each) => Stream.fromIterable(each)),
                )
              if (item.type !== "done")
                return events(parseAcpNotification(item.notification, session.sessionId, parser))
              return Stream.concat(
                followBackground(item.exit),
                Stream.suspend(() => events(finishAcpTurn(item.exit, parser))),
              )
            }),
          )
        const watch = turnInput.watch
        const stoppable = stopOnSteer(
          watch
            ? failOnSilence(
                body,
                () =>
                  watch.waiting() ||
                  follow.active ||
                  [...parser.tools.values()].some((tool) => !tool.done) ||
                  backgroundWorking(state.background, Date.now()),
                llmError(`${watch.name} stopped responding for ${SILENCE_LIMIT_MINUTES} minutes.`),
              )
            : body(Effect.void),
          turnInput.steer,
          Effect.suspend(() =>
            follow.active
              ? Deferred.succeed(follow.leave, undefined)
              : client.notify("session/cancel", { sessionId: session.sessionId }),
          ),
        )
        return Stream.concat(Stream.make(LLMEvent.stepStart({ index: 0 })), stoppable).pipe(
          Stream.ensuring(
            Effect.suspend(() => {
              if (parser.sessionCost !== undefined) state.sessionCost = parser.sessionCost
              for (const tool of parser.tools.values())
                if (tool.background && !state.background.has(tool.background))
                  state.background.set(tool.background, Date.now())
              for (const child of follow.reported) state.background.delete(child)
              for (const [child, started] of state.background)
                if (Date.now() - started >= BACKGROUND_LIMIT) state.background.delete(child)
              return parser.finished
                ? Effect.void
                : client.notify("session/cancel", { sessionId: session.sessionId }).pipe(Effect.ignore)
            }),
          ),
        )
      }).pipe(Effect.mapError((error) => llmError(errorMessage(error)))),
    )

  return {
    sessionId: session.sessionId,
    resumed: loaded !== undefined,
    mcpAttached: params.mcpServers.some((server) => "type" in server),
    closed: client.closed,
    backgroundWorking: () => backgroundWorking(state.background, Date.now()),
    agent: agentInfo(initialize),
    capabilities: agentCapabilities(initialize),
    models: selector.models,
    turn,
  } satisfies Session
})

const SESSION_SETUP_TIMEOUT = "60 seconds"
const PROMPT_UNWIND_TIMEOUT = "10 seconds"

export type McpServer =
  | {
      readonly type: "http"
      readonly name: string
      readonly url: string
      readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
    }
  | {
      readonly name: string
      readonly command: string
      readonly args: ReadonlyArray<string>
      readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>
    }

function createSession(
  client: Client,
  params: { readonly cwd: string; readonly mcpServers: ReadonlyArray<McpServer> },
) {
  return client.request("session/new", params, SESSION_SETUP_TIMEOUT).pipe(
    Effect.flatMap((response) => {
      const sessionId = isRecord(response) ? string(response.sessionId) : undefined
      return sessionId
        ? Effect.succeed({ sessionId, response })
        : Effect.fail(new ProtocolError("The ACP agent did not return a session ID."))
    }),
  )
}

export interface AcpTool {
  readonly name: string
  input: Record<string, unknown>
  called: boolean
  done: boolean
  readonly steps: Map<string, AcpStep>
  readonly transcript: AcpTranscriptEntry[]
  readonly entries: Map<string, AcpTranscriptTool>
  block?: { readonly type: "text" | "reasoning"; readonly messageId?: string; readonly entry: AcpTranscriptText }
  chars: number
  truncated?: boolean
  usage?: AcpUsage
  held?: { readonly failed: boolean; readonly update: Record<string, unknown> }
  childSession?: string
  background?: string
}

export interface AcpStep {
  readonly tool: string
  title?: string
  status: string
}

export interface AcpTranscriptText {
  readonly type: "text" | "reasoning"
  text: string
}

export interface AcpTranscriptTool {
  readonly type: "tool"
  readonly tool: string
  title?: string
  status: string
  output?: string
}

export type AcpTranscriptEntry = AcpTranscriptText | AcpTranscriptTool

export interface AcpUsage {
  readonly used?: number
  readonly size?: number
  readonly cost?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly thoughtTokens?: number
  readonly cachedReadTokens?: number
  readonly cachedWriteTokens?: number
}

export const TRANSCRIPT_LIMIT = 100_000
export const PROGRESS_ENTRIES = 50

export interface AcpState {
  readonly tools: Map<string, AcpTool>
  readonly children: Map<string, string>
  text?: { readonly id: string; readonly messageId?: string }
  reasoning?: { readonly id: string; readonly messageId?: string }
  blocks: number
  finished: boolean
  readonly previousCost?: number
  usage?: { readonly used?: number; readonly size?: number; readonly cost?: number }
  sessionCost?: number
  commands?: AcpCommand[]
  plans: number
}

export const acpState = (previousCost?: number): AcpState => ({
  tools: new Map(),
  children: new Map(),
  blocks: 0,
  finished: false,
  previousCost,
  plans: 0,
})

export function parseAcpNotification(
  notification: Notification,
  sessionId: string,
  state: AcpState,
): ReadonlyArray<LLMEvent> {
  if (notification.method !== "session/update") return []
  const params = isRecord(notification.params) ? notification.params : {}
  if (params.sessionId !== sessionId || !isRecord(params.update)) return []
  const update = params.update
  const kind = string(update.sessionUpdate)
  const child = childSession(update)
  if (child && child.id !== sessionId) return recordChild(state, child, kind, update)
  const claudeParent = claudeSubagent(update, state)
  if (claudeParent) {
    const id = `claude:${claudeParent}`
    state.children.set(id, claudeParent)
    return recordChild(state, { id }, kind, update)
  }
  if (kind === "plan") {
    const entries = Array.isArray(update.entries) ? update.entries.filter(isRecord) : []
    return [
      ...closeBlocks(state),
      ...planEvents(
        state,
        entries.map((entry) => ({ content: string(entry.content) ?? "", status: string(entry.status) ?? "pending" })),
      ),
    ]
  }
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const content = isRecord(update.content) ? update.content : undefined
    const text = content?.type === "text" ? string(content.text) : undefined
    if (!text) return []
    return kind === "agent_message_chunk"
      ? [...openText(state, string(update.messageId)), LLMEvent.textDelta({ id: state.text!.id, text })]
      : [...openReasoning(state, string(update.messageId)), LLMEvent.reasoningDelta({ id: state.reasoning!.id, text })]
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const id = string(update.toolCallId)
    if (!id) return []
    const closed = closeBlocks(state)
    const tool: AcpTool = state.tools.get(id) ?? {
      name: toolName(update),
      input: {},
      called: false,
      done: false,
      steps: new Map(),
      transcript: [],
      entries: new Map(),
      chars: 0,
    }
    state.tools.set(id, tool)
    if (!tool.called) tool.input = toolInput(tool.name, update, tool.input)
    const status = string(update.status)
    const terminal = status === "completed" || status === "failed"
    const ready = !tool.called && (terminal || status === "in_progress")
    if (ready) tool.called = true
    const start = ready ? [LLMEvent.toolCall({ id, name: tool.name, input: tool.input, providerExecuted: true })] : []
    const reported = tool.name === "acp_subagent" ? claudeSubagentUsage(update) : undefined
    if (reported) tool.usage = { ...tool.usage, ...reported }
    if (reported && tool.held) return [...closed, ...start, ...releaseHeld(id, tool)]
    if (tool.done || !terminal) return [...closed, ...start]
    tool.done = true
    if (tool.name === "acp_subagent") {
      tool.childSession ??= /<subagent sessionID="([^"]+)"/.exec(toolOutput(update))?.[1]
      tool.background = backgroundChild(toolOutput(update))
    }
    if (tool.name === "acp_subagent" && !tool.usage && isClaudeCodeUpdate(update)) {
      tool.held = { failed: status === "failed", update }
      return [...closed, ...start]
    }
    const value = toolOutput(update)
    return [
      ...closed,
      ...start,
      LLMEvent.toolResult({
        id,
        name: tool.name,
        providerExecuted: true,
        result: status === "failed" ? { type: "error", value } : { type: "text", value },
        ...resultMetadata(tool, update),
      }),
    ]
  }
  if (kind === "usage_update") {
    const cost = isRecord(update.cost) && update.cost.currency === "USD" ? number(update.cost.amount) : undefined
    state.usage = { used: number(update.used), size: number(update.size), cost }
    if (state.usage.used === undefined) return []
    return [
      LLMEvent.stepUsage({
        usage: { providerMetadata: { harness: { contextUsed: state.usage.used, contextSize: state.usage.size } } },
      }),
    ]
  }
  if (kind === "available_commands_update") {
    state.commands = commandList(update)
    return []
  }
  return []
}

const AUTH_REQUIRED = -32000

export function turnError(error: unknown) {
  if (!(error instanceof Error) || !error.message) return "The agent failed."
  return signInHint(error.message, error instanceof ProtocolError && error.code === AUTH_REQUIRED)
}

export function signInHint(message: string, signedOut = false) {
  const noLogin = /auth(entication)?[ _-]required|not (logged|signed) in|please (run \/login|log ?in|sign in)/i
  if (!signedOut && !noLogin.test(message)) return message
  return `The agent isn't signed in (${message}). Sign in from Settings → Harnesses, or run the agent's own login, then send again.`
}

export function replayedCost(notifications: ReadonlyArray<Notification>) {
  return notifications
    .flatMap((notification) => {
      const params = isRecord(notification.params) ? notification.params : {}
      const update = isRecord(params.update) ? params.update : {}
      if (update.sessionUpdate !== "usage_update" || !isRecord(update.cost) || update.cost.currency !== "USD") return []
      const amount = number(update.cost.amount)
      return amount === undefined ? [] : [amount]
    })
    .at(-1)
}

export function finishAcpTurn(exit: Exit.Exit<unknown, ProtocolError>, state: AcpState): ReadonlyArray<LLMEvent> {
  state.finished = true
  const held = [...state.tools].flatMap(([id, tool]) => (tool.held ? releaseHeld(id, tool) : []))
  const closed = [...closeBlocks(state), ...held]
  if (Exit.isFailure(exit)) {
    const error = Option.getOrUndefined(Exit.findErrorOption(exit))
    return [
      ...closed,
      LLMEvent.providerError({ message: turnError(error) }),
      LLMEvent.stepFinish({ index: 0, reason: "error" }),
      LLMEvent.finish({ reason: "error" }),
    ]
  }
  const response = isRecord(exit.value) ? exit.value : {}
  const harness = harnessUsage(state)
  const usage = normalizeUsage(isRecord(response.usage) ? response.usage : undefined, harness)
  const empty =
    response.stopReason !== "cancelled" && state.blocks === 0 && state.tools.size === 0 && !usage?.outputTokens
  if (empty)
    return [
      ...closed,
      LLMEvent.providerError({
        message:
          "The agent ended the turn without a reply. Its provider may have rejected the request: check the selected model and the agent's credentials.",
      }),
      LLMEvent.stepFinish({ index: 0, reason: "error", usage }),
      LLMEvent.finish({ reason: "error", usage }),
    ]
  const reason = finishReason(string(response.stopReason))
  return [...closed, LLMEvent.stepFinish({ index: 0, reason, usage }), LLMEvent.finish({ reason, usage })]
}

function harnessUsage(state: AcpState) {
  if (!state.usage) return undefined
  const amount = state.usage.cost
  if (amount !== undefined) state.sessionCost = amount
  return {
    contextUsed: state.usage.used,
    contextSize: state.usage.size,
    ...(amount === undefined ? {} : { cost: Math.max(0, amount - (state.previousCost ?? 0)), sessionCost: amount }),
  }
}

function openText(state: AcpState, messageId: string | undefined): ReadonlyArray<LLMEvent> {
  if (state.text && (messageId === undefined || messageId === state.text.messageId)) return []
  const closed = closeBlocks(state)
  state.text = { id: `acp-text-${++state.blocks}`, messageId }
  return [...closed, LLMEvent.textStart({ id: state.text.id })]
}

function openReasoning(state: AcpState, messageId: string | undefined): ReadonlyArray<LLMEvent> {
  if (state.reasoning && (messageId === undefined || messageId === state.reasoning.messageId)) return []
  const closed = closeBlocks(state)
  state.reasoning = { id: `acp-reasoning-${++state.blocks}`, messageId }
  return [...closed, LLMEvent.reasoningStart({ id: state.reasoning.id })]
}

function closeBlocks(state: AcpState): ReadonlyArray<LLMEvent> {
  const events = [
    ...(state.text ? [LLMEvent.textEnd({ id: state.text.id })] : []),
    ...(state.reasoning ? [LLMEvent.reasoningEnd({ id: state.reasoning.id })] : []),
  ]
  state.text = undefined
  state.reasoning = undefined
  return events
}

export function handleRequest(
  request: ServerRequest,
  approve: OpenInput["approve"],
  ask?: OpenInput["ask"],
): Effect.Effect<unknown, ProtocolError> {
  if (request.method === "elicitation/create" && ask) return elicit(request.params, ask)
  if (request.method !== "session/request_permission") return Effect.fail(unsupported(request.method))
  const params = isRecord(request.params) ? request.params : {}
  const tool = isRecord(params.toolCall) ? params.toolCall : {}
  const options = Array.isArray(params.options) ? params.options.filter(isRecord) : []
  const kind = string(tool.kind)
  const title = string(tool.title) ?? "Tool"
  const callID = string(tool.toolCallId)
  return approve({
    action: permissionAction(kind),
    resources: permissionResources(tool, title),
    title,
    kind,
    ...(callID ? { callID } : {}),
  }).pipe(
    Effect.map((allowed) => {
      const option = allowed
        ? pickOption(options, "allow_once", "allow_always")
        : pickOption(options, "reject_once", "reject_always")
      return { outcome: option ? { outcome: "selected", optionId: option } : { outcome: "cancelled" } }
    }),
  )
}

export function elicit(params: unknown, ask: NonNullable<OpenInput["ask"]>) {
  const fields = elicitationFields(params)
  if (fields.length === 0) return Effect.succeed({ action: "decline" })
  return ask(fields.map((field) => field.prompt)).pipe(
    Effect.map((answers) =>
      answers === undefined
        ? { action: "decline" }
        : { action: "accept", content: elicitationContent(fields, answers) },
    ),
  )
}

type FieldKind = "string" | "array" | "boolean" | "number" | "integer"

interface ElicitationField {
  readonly key: string
  readonly kind: FieldKind
  readonly values: ReadonlyMap<string, string>
  readonly custom?: string
  readonly prompt: QuestionV2.Prompt
}

export function elicitationFields(params: unknown): ReadonlyArray<ElicitationField> {
  const request = isRecord(params) ? params : {}
  const schema = isRecord(request.requestedSchema) ? request.requestedSchema : undefined
  if ((request.mode !== undefined && request.mode !== "form") || !isRecord(schema?.properties)) return []
  const properties = Object.entries(schema.properties).filter((entry): entry is [string, Record<string, unknown>] =>
    isRecord(entry[1]),
  )
  const keys = new Set(properties.map(([key]) => key))
  const isCustom = (key: string, field: Record<string, unknown>) =>
    key.endsWith("_custom") && keys.has(key.slice(0, -"_custom".length)) && field.type === "string"
  const asked = properties.filter(([key, field]) => !isCustom(key, field))
  const message = string(request.message) ?? "The agent has a question."
  return asked.flatMap(([key, field]) => {
    if (!isFieldKind(field.type)) return []
    const kind = field.type
    const choices = elicitationChoices(kind === "array" && isRecord(field.items) ? field.items : field, kind)
    const title = string(field.title)
    const custom = properties.find(([other, value]) => other === `${key}_custom` && isCustom(other, value))?.[0]
    return [
      {
        key,
        kind,
        values: new Map(choices.map((choice) => [choice.label, choice.value])),
        ...(custom ? { custom } : {}),
        prompt: {
          question: string(field.description) ?? (asked.length === 1 ? message : (title ?? key)),
          header: (title ?? key).slice(0, 30),
          options: choices.map((choice) => ({ label: choice.label, description: choice.description })),
          ...(kind === "array" ? { multiple: true } : {}),
        },
      },
    ]
  })
}

function isFieldKind(value: unknown): value is FieldKind {
  return value === "string" || value === "array" || value === "boolean" || value === "number" || value === "integer"
}

function elicitationChoices(field: Record<string, unknown>, kind: FieldKind) {
  if (kind === "boolean")
    return [
      { label: "Yes", value: "true", description: "" },
      { label: "No", value: "false", description: "" },
    ]
  const titled = [field.oneOf, field.anyOf].find(Array.isArray)
  if (titled)
    return titled.flatMap((option) => {
      if (!isRecord(option) || typeof option.const !== "string") return []
      return [
        {
          label: string(option.title) ?? option.const,
          value: option.const,
          description: string(option.description) ?? "",
        },
      ]
    })
  if (Array.isArray(field.enum))
    return field.enum.flatMap((value) => (typeof value === "string" ? [{ label: value, value, description: "" }] : []))
  return []
}

export function elicitationContent(fields: ReadonlyArray<ElicitationField>, answers: ReadonlyArray<QuestionV2.Answer>) {
  return Object.fromEntries(
    fields.flatMap((field, index) => {
      const answer = answers[index] ?? []
      const picked = answer.flatMap((item) => field.values.get(item) ?? [])
      const typed = answer.filter((item) => !field.values.has(item))
      const custom: Array<[string, unknown]> =
        field.custom && typed.length > 0 ? [[field.custom, typed.join(", ")]] : []
      const free = field.custom ? [] : typed
      const value = fieldValue(field.kind, picked, free)
      return value === undefined ? custom : [[field.key, value] as [string, unknown], ...custom]
    }),
  )
}

function fieldValue(kind: FieldKind, picked: ReadonlyArray<string>, typed: ReadonlyArray<string>) {
  if (kind === "array") return picked.length + typed.length > 0 ? [...picked, ...typed] : undefined
  const first = picked[0] ?? typed[0]
  if (first === undefined) return undefined
  if (kind === "boolean") return first === "true" || /^(y|yes|true)$/i.test(first.trim())
  if (kind === "string") return first
  const parsed = Number(first.trim())
  if (first.trim() === "" || !Number.isFinite(parsed)) return undefined
  return kind === "integer" ? Math.trunc(parsed) : parsed
}

function pickOption(options: ReadonlyArray<Record<string, unknown>>, preferred: string, fallback: string) {
  const option = options.find((item) => item.kind === preferred) ?? options.find((item) => item.kind === fallback)
  return string(option?.optionId)
}

export function permissionAction(kind: string | undefined) {
  if (kind === "execute") return "bash"
  if (kind === "edit" || kind === "delete" || kind === "move") return "edit"
  if (kind === "read" || kind === "search") return "read"
  if (kind === "fetch") return "webfetch"
  return "acp_tool"
}

function permissionResources(tool: Record<string, unknown>, title: string) {
  const input = isRecord(tool.rawInput) ? tool.rawInput : {}
  const command = Array.isArray(input.command)
    ? input.command.filter((part): part is string => typeof part === "string").join(" ")
    : string(input.command)
  const locations = Array.isArray(tool.locations)
    ? tool.locations.flatMap((location) => {
        const file = isRecord(location) ? string(location.path) : undefined
        return file ? [file] : []
      })
    : []
  const resources = [command, string(input.url), ...locations].filter((value): value is string => !!value)
  return resources.length > 0 ? resources : [title]
}

function toolName(update: Record<string, unknown>) {
  const claude = isRecord(update._meta) && isRecord(update._meta.claudeCode) ? update._meta.claudeCode : undefined
  const name = (string(update.name) ?? string(claude?.toolName))?.toLowerCase()
  if (name === "subagent" || name === "task" || name === "agent") return "acp_subagent"
  const kind = string(update.kind)
  return kind ? `acp_${kind}` : "acp_tool"
}

function toolInput(name: string, update: Record<string, unknown>, previous: Record<string, unknown>) {
  const raw = isRecord(update.rawInput) ? update.rawInput : {}
  const location = Array.isArray(update.locations) ? update.locations.find(isRecord) : undefined
  const path = string(location?.path)
  const title = string(update.title)
  const input = { ...previous, ...raw }
  if (Object.keys(raw).length === 0) return input
  return {
    ...input,
    ...(title && raw.title === undefined ? { title } : {}),
    ...(path && input.path === undefined ? { path } : {}),
    ...(name === "acp_subagent" && typeof raw.agent === "string" ? { subagent_type: raw.agent } : {}),
  }
}

function childSession(update: Record<string, unknown>) {
  const meta = isRecord(update._meta) ? update._meta["opencode/child-session"] : undefined
  if (!isRecord(meta)) return undefined
  const id = string(meta.id)
  return id ? { id, title: string(meta.title) } : undefined
}

function recordChild(
  state: AcpState,
  child: { readonly id: string; readonly title?: string },
  kind: string | undefined,
  update: Record<string, unknown>,
): ReadonlyArray<LLMEvent> {
  const description = child.title?.replace(SUBAGENT_TITLE_SUFFIX, "")
  const parentId = state.children.get(child.id) ?? subagentFor(state, description)
  const parent = parentId === undefined ? undefined : state.tools.get(parentId)
  if (parentId === undefined || !parent) return []
  if (!child.id.startsWith("claude:")) parent.childSession ??= child.id
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    state.children.set(child.id, parentId)
    const content = isRecord(update.content) ? update.content : undefined
    const text = content?.type === "text" ? string(content.text) : undefined
    if (!text) return []
    const ended = appendChunk(
      parent,
      kind === "agent_message_chunk" ? "text" : "reasoning",
      string(update.messageId),
      text,
    )
    return ended ? progress(parentId, parent) : []
  }
  if (kind === "usage_update") {
    state.children.set(child.id, parentId)
    parent.usage = { ...parent.usage, ...childUsage(update) }
    return []
  }
  if (kind !== "tool_call" && kind !== "tool_call_update") return []
  const id = string(update.toolCallId)
  if (!id) return []
  state.children.set(child.id, parentId)
  const before = parent.steps.get(id)
  const previous = before ? `${before.status}:${before.title}` : undefined
  const step = parent.steps.get(id) ?? { tool: toolName(update), status: "pending" }
  const raw = isRecord(update.rawInput) ? update.rawInput : {}
  const title =
    string(raw.command) ??
    string(raw.path) ??
    string(update.title)
      ?.replace(child.title ? `${child.title}: ` : "", "")
      .replace(description ? `${description}: ` : "", "")
  if (title) step.title = title
  step.status = string(update.status) ?? step.status
  parent.steps.set(id, step)
  const entry = parent.entries.get(id) ?? { type: "tool" as const, tool: step.tool, status: step.status }
  if (!parent.entries.has(id)) {
    parent.entries.set(id, entry)
    parent.transcript.push(entry)
    parent.block = undefined
  }
  if (step.title) entry.title = step.title
  entry.status = step.status
  if ((step.status === "completed" || step.status === "failed") && entry.output === undefined) {
    const output = withinBudget(parent, toolOutput(update))
    if (output) entry.output = output
  }
  if (previous === `${step.status}:${step.title}`) return []
  return progress(parentId, parent)
}

function appendChunk(tool: AcpTool, type: "text" | "reasoning", messageId: string | undefined, text: string) {
  const block = tool.block
  const merges = block?.type === type && (messageId === undefined || messageId === block.messageId)
  if (tool.truncated) return false
  const kept = withinBudget(tool, text)
  if (merges) {
    block.entry.text += kept
    return false
  }
  if (kept) {
    const entry = { type, text: kept }
    tool.transcript.push(entry)
    tool.block = { type, messageId, entry }
  }
  return block !== undefined
}

function withinBudget(tool: AcpTool, text: string) {
  if (tool.truncated) return ""
  const room = TRANSCRIPT_LIMIT - tool.chars
  if (text.length > room) tool.truncated = true
  const kept = text.length > room ? text.slice(0, room) : text
  tool.chars += kept.length
  return kept
}

export function reportedCommands(notification: Notification) {
  if (notification.method !== "session/update") return undefined
  const params = isRecord(notification.params) ? notification.params : {}
  const update = isRecord(params.update) ? params.update : {}
  return update.sessionUpdate === "available_commands_update" ? commandList(update) : undefined
}

function commandList(update: Record<string, unknown>): AcpCommand[] {
  const commands = Array.isArray(update.availableCommands) ? update.availableCommands.filter(isRecord) : []
  return commands.flatMap((command) => {
    const name = string(command.name)
    const description = string(command.description)
    return name ? [{ name, ...(description === undefined ? {} : { description }) }] : []
  })
}

export function openCodeUsageLookup(
  process: Partial<Pick<AppProcess.Interface, "run">>,
  settings: Settings,
  directory: string,
): ((sessionID: string) => Effect.Effect<AcpUsage | undefined>) | undefined {
  const at = settings.args.lastIndexOf("acp")
  const run = process.run
  if (at < 0 || !run) return undefined
  return (sessionID) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionID)) return Effect.succeed(undefined)
    return run(
      ChildProcess.make(
        settings.command,
        [...settings.args.slice(0, at), "api", "GET", `/api/session/${encodeURIComponent(sessionID)}`],
        {
          cwd: directory,
          env: harnessEnvironment(settings.env),
          extendEnv: false,
          stdin: "ignore",
        },
      ),
      { timeout: "10 seconds", maxOutputBytes: 1_000_000 },
    ).pipe(
      Effect.map((result) => openCodeSessionUsage(result.stdout.toString())),
      Effect.catch(() => Effect.succeed(undefined)),
    )
  }
}

export function openCodeSessionUsage(text: string): AcpUsage | undefined {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  })()
  const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : undefined
  const tokens = isRecord(data?.tokens) ? data.tokens : undefined
  if (!tokens) return undefined
  const cache = isRecord(tokens.cache) ? tokens.cache : {}
  const cost = number(data?.cost)
  const fields = {
    inputTokens: number(tokens.input),
    outputTokens: number(tokens.output),
    thoughtTokens: number(tokens.reasoning),
    cachedReadTokens: number(cache.read),
    cachedWriteTokens: number(cache.write),
    cost: cost && cost > 0 ? cost : undefined,
  }
  return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined))
}

export const FOLLOW_INTERVAL = "3 seconds"
export const FOLLOW_SETTLE = 30_000

export function openCodeMessageLookup(
  process: Partial<Pick<AppProcess.Interface, "run">>,
  settings: Settings,
  directory: string,
): ((sessionID: string) => Effect.Effect<ReadonlyArray<Record<string, unknown>> | undefined>) | undefined {
  const at = settings.args.lastIndexOf("acp")
  const run = process.run
  if (at < 0 || !run) return undefined
  return (sessionID) =>
    run(
      ChildProcess.make(
        settings.command,
        [...settings.args.slice(0, at), "api", "GET", `/api/session/${sessionID}/message?limit=50`],
        { cwd: directory, env: harnessEnvironment(settings.env), extendEnv: false, stdin: "ignore" },
      ),
      { timeout: "15 seconds", maxOutputBytes: 4_000_000 },
    ).pipe(
      Effect.map((result) => openCodeMessages(result.stdout.toString())),
      Effect.catch(() => Effect.succeed(undefined)),
    )
}

export function openCodeMessages(text: string): ReadonlyArray<Record<string, unknown>> | undefined {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  })()
  const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data.filter(isRecord) : undefined
  return data?.filter((message) => typeof message.id === "string")
}

export function followProgress(
  messages: ReadonlyArray<Record<string, unknown>>,
  seen: Set<string>,
  pending: Set<string>,
) {
  for (const message of messages) {
    const child =
      isRecord(message.metadata) && message.metadata.source === "subagent"
        ? string(message.metadata.childID)
        : undefined
    if (child) pending.delete(child)
  }
  const fresh = messages.filter((message) => !seen.has(String(message.id)) && !streaming(message)).reverse()
  for (const message of fresh) seen.add(String(message.id))
  return { fresh, idle: pending.size === 0 && messages[0]?.type === "idle" }
}

function streaming(message: Record<string, unknown>) {
  return message.type === "assistant" && !(isRecord(message.time) && typeof message.time.completed === "number")
}

const openCodeKinds: Record<string, string> = {
  shell: "execute",
  bash: "execute",
  read: "read",
  edit: "edit",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
  multiedit: "edit",
  grep: "search",
  glob: "search",
  list: "search",
  webfetch: "fetch",
  websearch: "fetch",
  subagent: "think",
  task: "think",
}

export function openCodeMessageUpdates(message: Record<string, unknown>): ReadonlyArray<Record<string, unknown>> {
  const messageId = String(message.id)
  if (message.type === "synthetic") {
    const text = string(message.description)
    const state = isRecord(message.metadata) ? string(message.metadata.state) : undefined
    return text && state
      ? [{ sessionUpdate: "agent_thought_chunk", messageId, content: { type: "text", text: `${text}: ${state}` } }]
      : []
  }
  if (message.type !== "assistant" || !Array.isArray(message.content)) return []
  return message.content.filter(isRecord).flatMap((part): Record<string, unknown>[] => {
    if (part.type === "text" || part.type === "reasoning") {
      const text = string(part.text)
      if (!text) return []
      return [
        {
          sessionUpdate: part.type === "text" ? "agent_message_chunk" : "agent_thought_chunk",
          messageId,
          content: { type: "text", text },
        },
      ]
    }
    if (part.type !== "tool" || !isRecord(part.state)) return []
    const id = string(part.id)
    const name = string(part.name) ?? "tool"
    const status = string(part.state.status)
    if (!id || (status !== "completed" && status !== "error")) return []
    const output = Array.isArray(part.state.content)
      ? part.state.content
          .filter(isRecord)
          .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
          .join("\n")
      : ""
    const error = isRecord(part.state.error) ? string(part.state.error.message) : undefined
    return [
      {
        sessionUpdate: "tool_call",
        toolCallId: id,
        name,
        title: name,
        kind: openCodeKinds[name] ?? "other",
        rawInput: isRecord(part.state.input) ? part.state.input : {},
        status: status === "completed" ? "completed" : "failed",
        content: [
          {
            type: "content",
            content: { type: "text", text: (status === "completed" ? output : error) || "Completed" },
          },
        ],
      },
    ]
  })
}

export function withSubagentUsage(
  events: ReadonlyArray<LLMEvent>,
  state: AcpState,
  lookup: ((sessionID: string) => Effect.Effect<AcpUsage | undefined>) | undefined,
): Effect.Effect<ReadonlyArray<LLMEvent>> {
  if (!lookup) return Effect.succeed(events)
  return Effect.forEach(events, (event) => {
    if (event.type !== "tool-result" || event.name !== "acp_subagent") return Effect.succeed(event)
    const tool = state.tools.get(event.id)
    const acp = isRecord(event.providerMetadata?.acp) ? event.providerMetadata.acp : undefined
    if (!tool?.childSession || !acp || isRecord(acp.usage)) return Effect.succeed(event)
    return lookup(tool.childSession).pipe(
      Effect.map((usage) => {
        if (!usage) return event
        tool.usage = { ...tool.usage, ...usage }
        return LLMEvent.toolResult({
          id: event.id,
          name: event.name,
          providerExecuted: event.providerExecuted,
          result: event.result,
          providerMetadata: { ...event.providerMetadata, acp: { ...acp, usage } },
        })
      }),
    )
  })
}

function releaseHeld(id: string, tool: AcpTool): ReadonlyArray<LLMEvent> {
  const held = tool.held
  if (!held) return []
  tool.held = undefined
  const value = toolOutput(held.update)
  return [
    LLMEvent.toolResult({
      id,
      name: tool.name,
      providerExecuted: true,
      result: held.failed ? { type: "error", value } : { type: "text", value },
      ...resultMetadata(tool, held.update),
    }),
  ]
}

function isClaudeCodeUpdate(update: Record<string, unknown>) {
  return isRecord(update._meta) && isRecord(update._meta.claudeCode)
}

export function claudeSubagentUsage(update: Record<string, unknown>): AcpUsage | undefined {
  const meta = isRecord(update._meta) && isRecord(update._meta.claudeCode) ? update._meta.claudeCode : undefined
  const response = isRecord(meta?.toolResponse) ? meta.toolResponse : undefined
  const usage = isRecord(response?.usage) ? response.usage : undefined
  if (!usage) return undefined
  const input = number(usage.input_tokens)
  const cacheRead = number(usage.cache_read_input_tokens)
  const cacheWrite = number(usage.cache_creation_input_tokens)
  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined
  const fields = {
    used: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    inputTokens: input,
    outputTokens: number(usage.output_tokens),
    thoughtTokens: number(details?.thinking_tokens),
    cachedReadTokens: cacheRead,
    cachedWriteTokens: cacheWrite,
  }
  return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined))
}

function childUsage(update: Record<string, unknown>): AcpUsage {
  const cost = isRecord(update.cost) && update.cost.currency === "USD" ? number(update.cost.amount) : undefined
  const fields = {
    used: number(update.used),
    size: number(update.size),
    cost,
    inputTokens: number(update.inputTokens),
    outputTokens: number(update.outputTokens),
    thoughtTokens: number(update.thoughtTokens),
    cachedReadTokens: number(update.cachedReadTokens),
    cachedWriteTokens: number(update.cachedWriteTokens),
  }
  return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined))
}

function progress(id: string, tool: AcpTool): ReadonlyArray<LLMEvent> {
  if (!tool.called || tool.done) return []
  return [LLMEvent.toolProgress({ id, name: tool.name, structured: { acp: subagentSnapshot(tool, true) } })]
}

function subagentSnapshot(tool: AcpTool, live = false) {
  const transcript = live ? tool.transcript.slice(-PROGRESS_ENTRIES) : tool.transcript
  return {
    steps: [...tool.steps.values()].map((item) => ({ ...item })),
    transcript: transcript.map((item) => {
      if (!live || item.type !== "tool") return { ...item }
      const { output: _, ...rest } = item
      return rest
    }),
    ...(tool.usage ? { usage: { ...tool.usage } } : {}),
    ...(tool.truncated ? { truncated: true } : {}),
  }
}

const SUBAGENT_TITLE_SUFFIX = /\s*\(@[^)]+ subagent\)$/

function subagentFor(state: AcpState, description: string | undefined) {
  const open = [...state.tools.entries()].filter((entry) => entry[1].name === "acp_subagent" && !entry[1].done)
  const claimed = new Set(state.children.values())
  const free = open.filter((entry) => !claimed.has(entry[0]))
  const named = (entry: (typeof open)[number]) => entry[1].input.description === description
  return (free.find(named) ?? open.find(named) ?? free.at(-1) ?? open.at(-1))?.[0]
}

function toolOutput(update: Record<string, unknown>) {
  const content = Array.isArray(update.content) ? update.content.filter(isRecord) : []
  const parts = content.flatMap((item) => {
    if (item.type === "content" && isRecord(item.content) && item.content.type === "text") {
      const text = string(item.content.text)
      return text ? [text] : []
    }
    if (item.type === "diff") return [`Edited ${string(item.path) ?? "file"}`]
    if (item.type === "terminal") return [`Terminal ${string(item.terminalId) ?? ""}`.trim()]
    return []
  })
  const output =
    parts.length > 0 ? parts.join("\n") : update.rawOutput === undefined ? "Completed" : json(update.rawOutput)
  return clipToolOutput(output)
}

const OUTPUT_HEAD = 8_000
const OUTPUT_TAIL = 24_000

export function clipToolOutput(output: string) {
  if (output.length <= OUTPUT_HEAD + OUTPUT_TAIL) return output
  const omitted = output.length - OUTPUT_HEAD - OUTPUT_TAIL
  return `${output.slice(0, OUTPUT_HEAD)}\n… ${omitted} characters omitted …\n${output.slice(-OUTPUT_TAIL)}`
}

export function planEvents(
  state: { plans: number },
  todos: ReadonlyArray<{ readonly content: string; readonly status: string }>,
): ReadonlyArray<LLMEvent> {
  state.plans += 1
  const id = `plan-${state.plans}-${Date.now().toString(36)}`
  const input = { todos: todos.filter((todo) => todo.content) }
  const done = input.todos.filter((todo) => todo.status === "completed").length
  return [
    LLMEvent.toolCall({ id, name: "todowrite", input, providerExecuted: true }),
    LLMEvent.toolResult({
      id,
      name: "todowrite",
      providerExecuted: true,
      result: { type: "text", value: `${done}/${input.todos.length} done` },
    }),
  ]
}

function claudeSubagent(update: Record<string, unknown>, state: AcpState) {
  const meta = isRecord(update._meta) && isRecord(update._meta.claudeCode) ? update._meta.claudeCode : undefined
  const parent = string(meta?.parentToolUseId)
  return parent && state.tools.get(parent)?.name === "acp_subagent" ? parent : undefined
}

function acpDiffs(update: Record<string, unknown>) {
  const content = Array.isArray(update.content) ? update.content.filter(isRecord) : []
  return content.flatMap((item) => {
    const path = string(item.path)
    if (item.type !== "diff" || !path) return []
    return [
      { path, oldText: typeof item.oldText === "string" ? item.oldText : "", newText: string(item.newText) ?? "" },
    ]
  })
}

function resultMetadata(tool: AcpTool, update: Record<string, unknown>) {
  if (tool.name === "acp_subagent") return { providerMetadata: { acp: subagentSnapshot(tool) } }
  const diffs = acpDiffs(update)
  const acp = {
    ...(tool.steps.size === 0 ? {} : { steps: [...tool.steps.values()] }),
    ...(diffs.length === 0 ? {} : { diffs }),
  }
  return Object.keys(acp).length === 0 ? {} : { providerMetadata: { acp } }
}

function finishReason(stopReason: string | undefined): FinishReason {
  if (stopReason === "max_tokens" || stopReason === "max_turn_requests") return "length"
  if (stopReason === "refusal") return "content-filter"
  if (stopReason === "end_turn" || stopReason === "cancelled") return "stop"
  return "unknown"
}

function normalizeUsage(value: Record<string, unknown> | undefined, harness?: Record<string, unknown>) {
  if (!value && !harness) return undefined
  const reported = number(value?.inputTokens)
  const read = number(value?.cachedReadTokens) ?? 0
  const write = number(value?.cachedWriteTokens)
  const output = number(value?.outputTokens)
  const total = number(value?.totalTokens)
  const exclusive =
    reported !== undefined &&
    (reported < read || (total !== undefined && total >= reported + read + (write ?? 0) + (output ?? 0)))
  const nonCached = reported === undefined ? undefined : exclusive ? reported : Math.max(0, reported - read)
  return {
    inputTokens: nonCached === undefined ? undefined : nonCached + read + (write ?? 0),
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: read,
    cacheWriteInputTokens: write,
    outputTokens: output,
    reasoningTokens: number(value?.thoughtTokens),
    totalTokens: total,
    ...(harness ? { providerMetadata: { harness } } : {}),
  }
}

export function sessionModels(response: unknown): {
  readonly models: ReadonlyArray<Harness.Model>
  readonly current?: string
  readonly configId?: string
  readonly effort?: EffortOption
  readonly variants?: ReadonlySet<string>
} {
  const value = isRecord(response) ? response : {}
  const configOptions = Array.isArray(value.configOptions) ? value.configOptions.filter(isRecord) : []
  const effort = effortOption(configOptions)
  const entry = (id: string | undefined, name: unknown, description: unknown, current: string | undefined) =>
    modelEntry(id, name, description, current, id === current ? (effort?.values ?? []) : [])
  if (isRecord(value.models)) {
    const current = string(value.models.currentModelId)
    const available = Array.isArray(value.models.availableModels) ? value.models.availableModels.filter(isRecord) : []
    const models = available.flatMap((model) => entry(string(model.modelId), model.name, model.description, current))
    return { current, effort, ...(effort ? { models } : foldVariants(models, current)) }
  }
  const option = configOptions.find(
    (item) => item.category === "model" && item.type === "select" && typeof item.id === "string",
  )
  if (!option) return { models: [], effort }
  const current = string(option.currentValue)
  const options = Array.isArray(option.options) ? option.options.filter(isRecord) : []
  return {
    configId: string(option.id),
    effort,
    ...foldDefault(
      options.flatMap((item) => entry(string(item.value), item.name, item.description, current)),
      current,
    ),
  }
}

function foldDefault(models: ReadonlyArray<Harness.Model>, current: string | undefined) {
  const row = models.find((model) => model.id === MODEL_DEFAULT)
  const name = row?.description
  const target = name
    ? models.find((model) => model !== row && (model.name === name || model.name.startsWith(`${name} `)))
    : undefined
  if (!row || !target) return { models, current }
  const active = current === MODEL_DEFAULT
  return {
    current: active ? target.id : current,
    models: models
      .filter((model) => model !== row)
      .map((model) =>
        model === target && active
          ? Harness.Model.make({ ...model, reasoningEfforts: row.reasoningEfforts, isDefault: true })
          : model,
      ),
  }
}

export type EffortOption = {
  readonly configId: string
  readonly current?: string
  readonly values: ReadonlyArray<string>
}

const EFFORT_DEFAULT = "default"
const MODEL_DEFAULT = "default"

function effortOption(configOptions: ReadonlyArray<Record<string, unknown>>): EffortOption | undefined {
  const option = configOptions.find(
    (item) => item.category === "thought_level" && item.type === "select" && typeof item.id === "string",
  )
  if (!option) return
  const values = (Array.isArray(option.options) ? option.options.filter(isRecord) : []).flatMap((item) => {
    const value = string(item.value)
    return value ? [value] : []
  })
  return { configId: option.id as string, current: string(option.currentValue), values }
}

function foldVariants(models: ReadonlyArray<Harness.Model>, current: string | undefined) {
  const byId = new Map(models.map((model) => [model.id, model]))
  const levels = new Map<string, string[]>()
  const variants = new Set(
    models.flatMap((model) => {
      const slash = model.id.lastIndexOf("/")
      const base = slash > 0 ? byId.get(model.id.slice(0, slash)) : undefined
      const level = model.id.slice(slash + 1)
      if (!base || model.name !== `${base.name} (${level})`) return []
      levels.set(base.id, [...(levels.get(base.id) ?? []), level])
      return [model.id]
    }),
  )
  if (variants.size === 0) return { models }
  return {
    variants,
    models: models
      .filter((model) => !variants.has(model.id))
      .map((model) =>
        Harness.Model.make({
          ...model,
          reasoningEfforts: levels.get(model.id) ?? model.reasoningEfforts,
          isDefault:
            model.isDefault || (current !== undefined && variants.has(current) && current.startsWith(`${model.id}/`)),
        }),
      ),
  }
}

function modelEntry(
  id: string | undefined,
  name: unknown,
  description: unknown,
  current: string | undefined,
  efforts: ReadonlyArray<string>,
) {
  if (!id) return []
  return [
    Harness.Model.make({
      id,
      name: string(name) ?? id,
      description: string(description),
      reasoningEfforts: efforts.filter((effort) => effort !== EFFORT_DEFAULT),
      serviceTiers: [],
      isDefault: id === current,
    }),
  ]
}

export function configuredModels(models: ReadonlyArray<string>) {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)), (id) =>
    Harness.Model.make({ id, name: id, reasoningEfforts: [], serviceTiers: [], isDefault: false }),
  )
}

function unsupported(method: string) {
  return new ProtocolError(`Unsupported ACP client method: ${method}`, { code: -32601 })
}

function llmError(message: string) {
  return new LLMError({ module: "AcpHarness", method: "stream", reason: new TransportReason({ message }) })
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The ACP agent is unavailable."
}

export function expandHome(input: string) {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2))
  return input
}

function json(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
