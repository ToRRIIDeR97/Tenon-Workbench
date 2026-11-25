import path from "node:path"
import { DEEP_LINK_SCHEME } from "./constants"
import { isUncPath } from "./local-file-policy"

export type DeepLink =
  | { kind: "open-project"; directory: string; url: string }
  | { kind: "new-session"; directory: string; prompt?: string; url: string }

const promptLimit = 16_000

export function parseDeepLink(value: string, isDirectory: (directory: string) => boolean): DeepLink | undefined {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return undefined
  if (url.hostname !== "open-project" && url.hostname !== "new-session") return undefined
  const directory = url.searchParams.get("directory")
  if (!directory || !isLocalDirectory(directory, isDirectory)) return undefined
  if (url.hostname === "open-project") {
    return { kind: "open-project", directory, url: rebuild("open-project", { directory }) }
  }
  const prompt = url.searchParams.get("prompt")?.slice(0, promptLimit) || undefined
  return {
    kind: "new-session",
    directory,
    ...(prompt ? { prompt } : {}),
    url: rebuild("new-session", prompt ? { directory, prompt } : { directory }),
  }
}

function isLocalDirectory(directory: string, isDirectory: (directory: string) => boolean) {
  if (isUncPath(directory)) return false
  if (/^file:/i.test(directory)) return false
  if (!path.isAbsolute(directory)) return false
  if (directory.split(/[\\/]/).includes("..")) return false
  return isDirectory(directory)
}

function rebuild(host: string, params: Record<string, string>) {
  return `${DEEP_LINK_SCHEME}://${host}?${new URLSearchParams(params).toString()}`
}

export function createDeepLinkQueue() {
  const pending: string[] = []
  const listening = new Set<number>()

  return {
    emit(urls: string[], target?: { id: number; send: (urls: string[]) => void }) {
      if (urls.length === 0) return
      if (target && listening.has(target.id)) return target.send(urls)
      pending.push(...urls)
    },
    consume(id: number) {
      listening.add(id)
      return pending.splice(0)
    },
    forget(id: number) {
      listening.delete(id)
    },
  }
}
