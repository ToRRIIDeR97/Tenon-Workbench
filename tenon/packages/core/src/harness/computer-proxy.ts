export * as HarnessComputerProxy from "./computer-proxy"

import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { Global } from "../global"
import { HarnessComputerUse } from "./computer-use"
import type { HarnessAskUser } from "./ask-user"

export type Tool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}
export type Result = { content: ReadonlyArray<Record<string, unknown>>; isError: boolean }
export type Answer = "thread" | "once" | "deny"
export type Caller = { sessionID: string; directory: string; harness: string }
export type Driver = {
  tools: () => Promise<ReadonlyArray<Tool>>
  call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ content?: ReadonlyArray<Record<string, unknown>>; isError?: boolean }>
  stop: () => void
}
export type Indicator = (event: { active: boolean; idle?: boolean; harness?: string; sessionID?: string }) => void

export function isRead(tool: Pick<Tool, "name" | "annotations">) {
  if (tool.annotations?.readOnlyHint) return true
  return /^(screenshot|get_|list_|read_|find_|describe|query|status|capture|observe|wait)/i.test(tool.name)
}

const text = (value: string) => [{ type: "text", text: value }]

export function describeAction(name: string, args: Record<string, unknown>) {
  const detail = Object.entries(args)
    .map(
      ([key, value]) =>
        `${key} ${typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : JSON.stringify(value)}`,
    )
    .join(", ")
  return detail ? `${name} (${detail.slice(0, 80)})` : name
}

const RECENT_MS = 60_000
const STOP_NOTE_MS = 10 * 60_000

export function make(input: {
  driver: Driver
  enabled: (directory: string) => Promise<boolean>
  indicator?: Indicator
  now?: () => number
}) {
  const now = input.now ?? Date.now
  const grants = new Set<string>()
  const asking = new Map<string, Promise<Answer>>()
  const stopped = new Set<string>()
  const active = new Set<string>()
  const recent = new Map<string, { directory: string; at: number }>()
  let lastStop: { at: number; folders: string[] } | undefined
  let listed: Promise<ReadonlyArray<Tool>> | undefined
  let generation = 0
  let running = 0
  const list = () => (listed ??= input.driver.tools().catch((error) => ((listed = undefined), Promise.reject(error))))

  return {
    async tools(caller: Pick<Caller, "directory">) {
      if (!(await input.enabled(caller.directory))) return []
      return list().catch(() => [])
    },
    allTools: () => list().catch(() => [] as ReadonlyArray<Tool>),
    async call(
      name: string,
      args: Record<string, unknown>,
      caller: Caller,
      ask: (question: string) => Promise<Answer>,
    ): Promise<Result> {
      if (!(await input.enabled(caller.directory)))
        return {
          content: text("Computer use was turned off for this Project, so this action was not run."),
          isError: true,
        }
      if (stopped.delete(caller.sessionID))
        return {
          content: text("The user pressed Stop on computer use. Ask them before using the desktop again."),
          isError: true,
        }
      const tool = (await list().catch(() => [])).find((item) => item.name === name)
      if (!tool) return { content: text(`${name} isn't a computer use tool.`), isError: true }
      if (!isRead(tool) && !grants.has(caller.sessionID)) {
        const pending =
          asking.get(caller.sessionID) ??
          ask(
            `Let ${caller.harness} click and type on your desktop?\nFirst action: ${describeAction(name, args)}. Screenshots don't ask.`,
          ).finally(() => asking.delete(caller.sessionID))
        asking.set(caller.sessionID, pending)
        const asked = generation
        const answer = await pending
        if (generation !== asked) return { content: text("The user pressed Stop on computer use."), isError: true }
        if (answer === "deny")
          return { content: text("The user didn't allow this thread to use the desktop."), isError: true }
        if (answer === "thread") grants.add(caller.sessionID)
      }
      const started = generation
      running++
      active.add(caller.sessionID)
      recent.set(caller.sessionID, { directory: caller.directory, at: now() })
      input.indicator?.({ active: true, harness: caller.harness, sessionID: caller.sessionID })
      return input.driver
        .call(name, args)
        .then(
          (result): Result => ({ content: result.content ?? text(""), isError: result.isError === true }),
          (error: unknown): Result => ({
            content: text(
              generation !== started
                ? "Stopped: the user shut computer use down with Stop, so the driver was shut down."
                : error instanceof Error
                  ? error.message
                  : String(error),
            ),
            isError: true,
          }),
        )
        .finally(() => {
          running--
          if (running === 0) active.clear()
          if (running === 0 && generation === started)
            input.indicator?.({ active: true, idle: true, harness: caller.harness })
        })
    },
    stop() {
      const at = now()
      for (const [session, use] of recent) if (active.has(session) || at - use.at <= RECENT_MS) stopped.add(session)
      lastStop = {
        at,
        folders: [...stopped].flatMap((session) => {
          const use = recent.get(session)
          return use ? [use.directory] : []
        }),
      }
      recent.clear()
      active.clear()
      generation++
      input.driver.stop()
      grants.clear()
      listed = undefined
      input.indicator?.({ active: false })
    },
    stoppedIn(folder: string) {
      if (!lastStop || now() - lastStop.at > STOP_NOTE_MS) return 0
      return lastStop.folders.filter(
        (directory) => HarnessComputerUse.sameFolder(directory, folder) || HarnessComputerUse.inside(folder, directory),
      ).length
    },
  }
}

export function askInDock(ask: HarnessAskUser.Ask | undefined) {
  return async (question: string): Promise<Answer> => {
    if (!ask) return "deny"
    const outcome = await ask(
      [
        {
          question,
          header: "Computer use",
          options: [
            {
              label: "Allow for this thread",
              description: "Clicks and typing in this thread run without asking again.",
            },
            { label: "Just this once", description: "Run this action; ask again next time." },
            { label: "Don't allow", description: "Nothing is clicked or typed." },
          ],
        },
      ],
      300,
    )
    if (outcome.type !== "answered") return "deny"
    const label = outcome.answers[0]?.[0] ?? ""
    return label.startsWith("Allow") ? "thread" : label.startsWith("Just") ? "once" : "deny"
  }
}

export function driverClient(command: () => string | undefined): Driver {
  let child: ChildProcessWithoutNullStreams | undefined
  let ready: Promise<void> | undefined
  let next = 0
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  const start = () => {
    const path = command()
    if (!path) return Promise.reject(new Error("The Cua Driver isn't installed."))
    const proc = spawn(path, ["mcp"], { stdio: "pipe", windowsHide: true })
    child = proc
    let buffer = ""
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (!line) continue
        const message = (() => {
          try {
            return JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
          } catch {
            return undefined
          }
        })()
        const waiting = message?.id === undefined ? undefined : pending.get(message.id)
        if (!waiting || message?.id === undefined) continue
        pending.delete(message.id)
        if (message.error) waiting.reject(new Error(message.error.message ?? "The Cua Driver failed."))
        else waiting.resolve(message.result)
      }
    })
    proc.on("exit", () => {
      if (child === proc) {
        child = undefined
        ready = undefined
      }
      for (const waiting of pending.values()) waiting.reject(new Error("The Cua Driver stopped."))
      pending.clear()
    })
    return request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tenon-workbench", version: "1" },
    }).then(() => void send({ jsonrpc: "2.0", method: "notifications/initialized" }))
  }
  const send = (message: Record<string, unknown>) => child?.stdin.write(`${JSON.stringify(message)}\n`)
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      send({ jsonrpc: "2.0", id, method, params })
      setTimeout(() => {
        if (!pending.delete(id)) return
        reject(new Error(`The Cua Driver didn't answer ${method}.`))
      }, 120_000)
    })
  const connected = () => (ready ??= start().catch((error) => ((ready = undefined), Promise.reject(error))))

  return {
    tools: () =>
      connected()
        .then(() => request("tools/list", {}))
        .then((result) => ((result as { tools?: ReadonlyArray<Tool> })?.tools ?? []) as ReadonlyArray<Tool>),
    call: (name, args) =>
      connected()
        .then(() => request("tools/call", { name, arguments: args }))
        .then((result) => result as { content?: ReadonlyArray<Record<string, unknown>>; isError?: boolean }),
    stop: () => {
      child?.kill()
      child = undefined
      ready = undefined
    },
  }
}

const bridge = (route: string, body: Record<string, unknown>, timeoutMs = 5_000) => {
  const url = process.env.TENON_BROWSER_URL
  const token = process.env.TENON_BROWSER_TOKEN
  if (!url || !token) return Promise.resolve(undefined)
  return fetch(`${url}/${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then((response) => response.json() as Promise<{ text?: string }>)
    .then((body) => (body.text ? (JSON.parse(body.text) as { stop?: boolean }) : {}))
    .catch(() => undefined)
}

let watching = false
function watchStop() {
  if (watching) return
  watching = true
  void (async () => {
    while (watching) {
      const answer = await bridge("computer_watch", {}, 65_000)
      if (answer === undefined) break
      if (answer.stop) shared.stop()
    }
    watching = false
  })()
}

export const shared = make({
  driver: driverClient(HarnessComputerUse.findDriver),
  enabled: (directory) => HarnessComputerUse.enabledFor(directory, Global.make().config).catch(() => false),
  indicator: (event) => {
    void bridge("computer_indicator", event)
    if (event.active) watchStop()
    else watching = false
  },
})
