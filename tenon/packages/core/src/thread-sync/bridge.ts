import { Option, Schema } from "effect"
import { driveStore } from "./drive"
import { syncError } from "./error"
import type { Credentials } from "./manager"

const BRIDGE_TIMEOUT_MS = 5_000

const Answer = Schema.Struct({ key: Schema.optional(Schema.String), token: Schema.optional(Schema.String) })
const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(Answer))
const Reply = Schema.Struct({ text: Schema.optional(Schema.String), error: Schema.optional(Schema.Unknown) })
const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(Reply))

export function bridgeCredentials(env: Readonly<Record<string, string | undefined>>): Credentials {
  const url = env.TENON_BROWSER_URL
  const token = env.TENON_BROWSER_TOKEN

  const ask = async (route: "sync_key" | "sync_token") => {
    if (!url || !token) return undefined
    const response = await fetch(`${url}/${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    })
    const body = Option.getOrUndefined(decodeReply(await response.text().catch(() => "")))
    if (!response.ok || !body || body.error !== undefined || body.text === undefined) return undefined
    return Option.getOrUndefined(decodeAnswer(body.text))
  }

  const accessToken = async () => {
    const answer = await ask("sync_token").catch(() => {
      throw syncError("unavailable", "Tenon Workbench could not be asked for a Google Drive token")
    })
    if (!answer?.token) throw syncError("unauthorized", "Sign in to Google again to sync threads")
    return answer.token
  }

  return {
    async key() {
      const answer = await ask("sync_key")
      if (!answer?.key) return undefined
      return Uint8Array.from(Buffer.from(answer.key, "base64url"))
    },
    async store(driveFolder) {
      const answer = await ask("sync_token")
      if (!answer?.token) return undefined
      return driveStore({ token: accessToken, folder: driveFolder })
    },
  }
}
