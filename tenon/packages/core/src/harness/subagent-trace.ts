export * as HarnessSubagentTrace from "./subagent-trace"

import { Effect } from "effect"
import os from "node:os"
import path from "node:path"
import { readdir, readFile } from "node:fs/promises"
import type { AcpUsage } from "./acp"

export type Kind = "opencode-session" | "claude-agent"

export interface Ref {
  readonly kind: Kind
  readonly id: string
  readonly directory: string
}

const OPENCODE_SESSION = /<subagent sessionID="(ses_[A-Za-z0-9_-]{1,128})"/
const OPENCODE_BACKGROUND = /\(sessionID: (ses_[A-Za-z0-9_-]{1,128})\)/
const CLAUDE_AGENT = /\bagentId: (a[0-9a-f]{8,40})\b/

export const TRANSCRIPT_BYTES = 64 * 1024 * 1024

export function ref(harness: string, output: string, directory: string): Ref | undefined {
  if (harness === "opencode-acp") {
    const id = OPENCODE_SESSION.exec(output)?.[1] ?? OPENCODE_BACKGROUND.exec(output)?.[1]
    return id ? { kind: "opencode-session", id, directory } : undefined
  }
  if (harness === "claude-code") {
    const id = CLAUDE_AGENT.exec(output)?.[1]
    return id ? { kind: "claude-agent", id, directory } : undefined
  }
  return undefined
}

export const key = (item: Pick<Ref, "kind" | "id">) => `${item.kind}:${item.id}`

export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>) {
  return env.CLAUDE_CONFIG_DIR || path.join(env.HOME || env.USERPROFILE || os.homedir(), ".claude")
}

export function claudeProjectFolder(directory: string) {
  return directory.replace(/[^a-zA-Z0-9]/g, "-")
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0)

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function claudeTranscriptUsage(text: string): AcpUsage | undefined {
  const turns = new Map<string, Record<string, unknown>>()
  let index = 0
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const entry: unknown = (() => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })()
    const message = record(entry) && record(entry.message) ? entry.message : undefined
    if (!message || !record(message.usage)) continue
    turns.set(typeof message.id === "string" && message.id ? message.id : `line-${index++}`, message.usage)
  }
  if (turns.size === 0) return undefined
  const sum = (field: string) => [...turns.values()].reduce((total, usage) => total + number(usage[field]), 0)
  const usage = {
    inputTokens: sum("input_tokens"),
    outputTokens: sum("output_tokens"),
    cachedReadTokens: sum("cache_read_input_tokens"),
    cachedWriteTokens: sum("cache_creation_input_tokens"),
  }
  return Object.values(usage).some((value) => value > 0) ? usage : undefined
}

const listDirs = (folder: string) =>
  readdir(folder, { withFileTypes: true }).then(
    (items) => items.filter((item) => item.isDirectory()).map((item) => item.name),
    () => [] as string[],
  )

const readSmall = async (file: string) => {
  const text = await readFile(file, "utf8").catch(() => undefined)
  return text !== undefined && text.length <= TRANSCRIPT_BYTES ? text : undefined
}

export async function findClaudeTranscript(input: { configDir: string; directory: string; agentId: string }) {
  if (!CLAUDE_AGENT.test(`agentId: ${input.agentId}`)) return undefined
  const projects = path.join(input.configDir, "projects")
  const file = `agent-${input.agentId}.jsonl`
  const preferred = claudeProjectFolder(input.directory)
  const folders = [preferred, ...(await listDirs(projects)).filter((name) => name !== preferred)]
  for (const folder of folders) {
    for (const session of await listDirs(path.join(projects, folder))) {
      const candidate = path.join(projects, folder, session, "subagents", file)
      const text = await readSmall(candidate)
      if (text !== undefined) return text
    }
  }
  return undefined
}

export const claudeAgentUsage = (input: { configDir: string; directory: string; agentId: string }) =>
  Effect.promise(() => findClaudeTranscript(input)).pipe(
    Effect.map((text) => (text === undefined ? undefined : claudeTranscriptUsage(text))),
  )
