/**
 * Mail providers for the Command Centre's mail tools: Gmail, Microsoft Graph (Outlook) and IMAP.
 * Each can search, read a thread and save a draft. None of them sends: there is no call to Gmail
 * `messages/send` or `drafts/send`, Graph `/send` or `sendMail`, or SMTP anywhere in this folder.
 * This module is pure (no Electron), so the parsing is tested with a fake fetch.
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
] as const

export const GRAPH_SCOPES = ["Mail.Read", "Mail.ReadWrite", "offline_access"] as const

export type MailSummary = { id: string; subject: string; from: string; date: string; snippet: string }
export type MailMessage = { from: string; to: string; date: string; text: string }
export type MailThread = { id: string; messages: MailMessage[] }
export type DraftInput = { to: string; subject: string; body: string; replyTo?: string }

export interface MailProvider {
  search(query: string): Promise<MailSummary[]>
  readThread(id: string): Promise<MailThread>
  createDraft(input: DraftInput): Promise<{ id: string }>
}

type Fetch = typeof globalThis.fetch
type Token = () => Promise<string>

const resultLimit = 20
const textLimit = 50_000

// ---------------------------------------------------------------------------------------------
// Gmail

const gmailBase = "https://gmail.googleapis.com/gmail/v1/users/me"

type GmailHeader = { name?: string; value?: string }
type GmailPart = {
  mimeType?: string
  headers?: GmailHeader[]
  body?: { data?: string }
  parts?: GmailPart[]
}
type GmailMessage = { id?: string; threadId?: string; snippet?: string; payload?: GmailPart }

export function createGmailProvider(input: { fetch: Fetch; accessToken: Token }): MailProvider {
  const call = async <T>(url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set("Authorization", `Bearer ${await input.accessToken()}`)
    if (init?.body) headers.set("Content-Type", "application/json")
    const response = await input.fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`gmail_request_failed_${response.status}`)
    return (await response.json()) as T
  }
  return {
    async search(query) {
      const list = await call<{ messages?: { id?: string; threadId?: string }[] }>(
        `${gmailBase}/messages?${new URLSearchParams({ q: query, maxResults: String(resultLimit) })}`,
      )
      const seen = new Set<string>()
      const first = (list.messages ?? []).filter(
        (item): item is { id: string; threadId: string } =>
          !!item.id && !!item.threadId && !seen.has(item.threadId) && !!seen.add(item.threadId),
      )
      const metadata = new URLSearchParams({ format: "metadata" })
      for (const name of ["Subject", "From", "Date"]) metadata.append("metadataHeaders", name)
      return Promise.all(
        first.map(async (item) => {
          const message = await call<GmailMessage>(`${gmailBase}/messages/${encodeURIComponent(item.id)}?${metadata}`)
          const headers = message.payload?.headers ?? []
          return {
            id: message.threadId ?? item.threadId,
            subject: header(headers, "Subject"),
            from: header(headers, "From"),
            date: header(headers, "Date"),
            snippet: decodeEntities(message.snippet ?? ""),
          }
        }),
      )
    },
    async readThread(id) {
      const thread = await call<{ id?: string; messages?: GmailMessage[] }>(
        `${gmailBase}/threads/${encodeURIComponent(id)}?format=full`,
      )
      return {
        id: thread.id ?? id,
        messages: (thread.messages ?? []).map((message) => {
          const headers = message.payload?.headers ?? []
          return {
            from: header(headers, "From"),
            to: header(headers, "To"),
            date: header(headers, "Date"),
            text: gmailText(message.payload),
          }
        }),
      }
    },
    async createDraft(draft) {
      const raw = Buffer.from(rfc822(draft), "utf8").toString("base64url")
      const created = await call<{ id?: string }>(`${gmailBase}/drafts`, {
        method: "POST",
        body: JSON.stringify({ message: { raw, ...(draft.replyTo ? { threadId: draft.replyTo } : {}) } }),
      })
      if (!created.id) throw new Error("gmail_draft_failed")
      return { id: created.id }
    },
  }
}

function header(headers: GmailHeader[], name: string) {
  return headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
}

/** The plain text of a Gmail payload: its text/plain part, else its HTML reduced to text. */
function gmailText(part: GmailPart | undefined): string {
  if (!part) return ""
  const parts = flatten(part)
  const plain = parts.find((item) => item.mimeType === "text/plain" && item.body?.data)
  if (plain?.body?.data) return clip(Buffer.from(plain.body.data, "base64url").toString("utf8").trim())
  const html = parts.find((item) => item.mimeType === "text/html" && item.body?.data)
  if (html?.body?.data) return clip(htmlToText(Buffer.from(html.body.data, "base64url").toString("utf8")))
  return ""
}

function flatten(part: GmailPart): GmailPart[] {
  return [part, ...(part.parts ?? []).flatMap(flatten)]
}

// ---------------------------------------------------------------------------------------------
// Microsoft Graph

const graphBase = "https://graph.microsoft.com/v1.0/me"

type GraphAddress = { emailAddress?: { name?: string; address?: string } }
type GraphMessage = {
  id?: string
  conversationId?: string
  subject?: string
  from?: GraphAddress
  toRecipients?: GraphAddress[]
  receivedDateTime?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
}

export function createGraphProvider(input: { fetch: Fetch; accessToken: Token }): MailProvider {
  const call = async <T>(url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set("Authorization", `Bearer ${await input.accessToken()}`)
    // Plain-text bodies keep HTML out of the agent's context where Outlook can convert them.
    headers.set("Prefer", 'outlook.body-content-type="text"')
    if (init?.body) headers.set("Content-Type", "application/json")
    const response = await input.fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`graph_request_failed_${response.status}`)
    return (await response.json()) as T
  }
  // A conversation's messages, oldest first ($orderby with this $filter is refused by Graph).
  const conversation = async (id: string) => {
    const params = new URLSearchParams({
      $filter: `conversationId eq '${id.replaceAll("'", "''")}'`,
      $top: "50",
      $select: "id,from,toRecipients,receivedDateTime,body",
    })
    const result = await call<{ value?: GraphMessage[] }>(`${graphBase}/messages?${params}`)
    return (result.value ?? []).toSorted((left, right) =>
      (left.receivedDateTime ?? "").localeCompare(right.receivedDateTime ?? ""),
    )
  }
  const latestMessage = async (id: string) => (await conversation(id)).at(-1)?.id
  return {
    async search(query) {
      const params = new URLSearchParams({
        $search: `"${query.replaceAll('"', "")}"`,
        $top: String(resultLimit),
        $select: "id,conversationId,subject,from,receivedDateTime,bodyPreview",
      })
      const result = await call<{ value?: GraphMessage[] }>(`${graphBase}/messages?${params}`)
      const seen = new Set<string>()
      return (result.value ?? []).flatMap((message) => {
        const id = message.conversationId ?? message.id
        if (!id || seen.has(id)) return []
        seen.add(id)
        return [
          {
            id,
            subject: message.subject ?? "",
            from: address(message.from),
            date: message.receivedDateTime ?? "",
            snippet: message.bodyPreview ?? "",
          },
        ]
      })
    },
    async readThread(id) {
      return {
        id,
        messages: (await conversation(id)).map((message) => ({
          from: address(message.from),
          to: (message.toRecipients ?? []).map(address).join(", "),
          date: message.receivedDateTime ?? "",
          text: clip(
            message.body?.contentType?.toLowerCase() === "html"
              ? htmlToText(message.body.content ?? "")
              : (message.body?.content ?? "").trim(),
          ),
        })),
      }
    },
    async createDraft(draft) {
      // Both calls save a draft in Drafts (createReply makes a reply draft); nothing here calls /send.
      const latest = draft.replyTo ? await latestMessage(draft.replyTo) : undefined
      const created = await call<{ id?: string }>(
        latest ? `${graphBase}/messages/${encodeURIComponent(latest)}/createReply` : `${graphBase}/messages`,
        {
          method: "POST",
          body: JSON.stringify(
            latest
              ? { comment: draft.body }
              : {
                  subject: draft.subject,
                  body: { contentType: "Text", content: draft.body },
                  toRecipients: recipients(draft.to).map((item) => ({ emailAddress: { address: item } })),
                },
          ),
        },
      )
      if (!created.id) throw new Error("graph_draft_failed")
      return { id: created.id }
    },
  }
}

function address(value: GraphAddress | undefined) {
  const email = value?.emailAddress
  if (!email) return ""
  return email.name && email.address ? `${email.name} <${email.address}>` : (email.address ?? email.name ?? "")
}

// ---------------------------------------------------------------------------------------------
// IMAP

/** The few IMAP operations the provider needs; `createImapClient` implements them with imapflow. */
export interface ImapClient {
  search(query: string): Promise<MailSummary[]>
  fetchThread(id: string): Promise<MailThread>
  append(mailbox: string, raw: string, flags: string[]): Promise<{ uid?: number | string }>
}

export function createImapProvider(input: { client: ImapClient }): MailProvider {
  return {
    search: (query) => input.client.search(query),
    readThread: (id) => input.client.fetchThread(id),
    async createDraft(draft) {
      // The client maps "Drafts" to the account's \Drafts special-use mailbox.
      const appended = await input.client.append("Drafts", rfc822(draft), ["\\Draft"])
      if (appended.uid === undefined) throw new Error("imap_draft_failed")
      return { id: String(appended.uid) }
    },
  }
}

type SafeStorage = { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer }

/** Store an IMAP app password, encrypted with the OS keychain (Electron safeStorage); never in plain text. */
export async function saveImapPassword(
  deps: { safeStorage: SafeStorage; write: (key: string, value: string) => Promise<void> | void },
  accountId: string,
  password: string,
) {
  if (!deps.safeStorage.isEncryptionAvailable()) throw new Error("mail_secure_storage_unavailable")
  await deps.write(`imap-password:${accountId}`, deps.safeStorage.encryptString(password).toString("base64"))
}

// ---------------------------------------------------------------------------------------------
// Shared

/** A plain-text RFC 822 message for a draft. Header values lose line breaks so they can't add headers. */
export function rfc822(draft: DraftInput) {
  const line = (value: string) => value.replace(/[\r\n]+/g, " ").trim()
  return [
    `To: ${line(recipients(draft.to).join(", "))}`,
    `Subject: ${encodeHeader(line(draft.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    draft.body.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n")
}

function encodeHeader(value: string) {
  // RFC 2047 for anything outside printable ASCII.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
}

function recipients(value: string) {
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function clip(text: string) {
  return text.length > textLimit ? `${text.slice(0, textLimit)}…` : text
}

/** HTML reduced to readable text: scripts and styles dropped, blocks become lines, tags removed. */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match
    }
    return entities[code.toLowerCase()] ?? match
  })
}
