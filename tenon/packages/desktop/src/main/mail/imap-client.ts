import type { FetchMessageObject, ImapFlow, MessageStructureObject } from "imapflow"
import { htmlToText, type ImapClient, type MailSummary } from "./index"

export type ImapSettings = { host: string; port: number; secure: boolean; user: string; password: string }

const resultLimit = 20
const partLimit = 512 * 1024

/**
 * IMAP through imapflow (MIT): one short-lived connection per call, so no idle socket stays open. A
 * thread is one message here (IMAP has no portable thread id): `INBOX:<uid>`. Drafts go to the
 * mailbox flagged `\Drafts`, or one named Drafts.
 */
export function createImapClient(settings: ImapSettings): ImapClient {
  const session = async <T>(run: (client: ImapFlow) => Promise<T>) => {
    const { ImapFlow } = await import("imapflow")
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.password },
      logger: false,
      disableAutoIdle: true,
    })
    await client.connect()
    try {
      return await run(client)
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  return {
    search: (query) =>
      session(async (client) => {
        const lock = await client.getMailboxLock("INBOX", { readOnly: true })
        try {
          const found = await client.search(
            { or: [{ subject: query }, { from: query }, { body: query }] },
            { uid: true },
          )
          const uids = (found || []).slice(-resultLimit).reverse()
          if (uids.length === 0) return []
          const messages = await client.fetchAll(uids, { uid: true, envelope: true }, { uid: true })
          return messages
            .toSorted((left, right) => right.uid - left.uid)
            .map(
              (message): MailSummary => ({
                id: `INBOX:${message.uid}`,
                subject: message.envelope?.subject ?? "",
                from: (message.envelope?.from ?? []).map((item) => item.address ?? item.name ?? "").join(", "),
                date: message.envelope?.date ? new Date(message.envelope.date).toISOString() : "",
                snippet: "",
              }),
            )
        } finally {
          lock.release()
        }
      }),
    fetchThread: (id) =>
      session(async (client) => {
        const [mailbox, uid] = parseId(id)
        const lock = await client.getMailboxLock(mailbox, { readOnly: true })
        try {
          const message = await client.fetchOne(uid, { uid: true, envelope: true, bodyStructure: true }, { uid: true })
          if (!message) return { id, messages: [] }
          return { id, messages: [{ ...addresses(message), text: await bodyText(client, message) }] }
        } finally {
          lock.release()
        }
      }),
    append: (_mailbox, raw, flags) =>
      session(async (client) => {
        const mailboxes = await client.list()
        const drafts =
          mailboxes.find((item) => item.specialUse === "\\Drafts")?.path ??
          mailboxes.find((item) => item.name.toLowerCase() === "drafts")?.path ??
          "Drafts"
        const result = await client.append(drafts, raw, flags)
        if (!result) throw new Error("imap_draft_failed")
        return { uid: result.uid ?? `${result.destination}:appended` }
      }),
  }
}

/** Log in and out once, so a wrong host or password is caught before the account is kept. */
export async function verifyImap(settings: ImapSettings) {
  const { ImapFlow } = await import("imapflow")
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    disableAutoIdle: true,
  })
  await client.connect()
  await client.logout().catch(() => undefined)
}

function parseId(id: string): [string, string] {
  const index = id.lastIndexOf(":")
  if (index <= 0 || !/^\d+$/.test(id.slice(index + 1))) throw new Error("imap_invalid_id")
  return [id.slice(0, index), id.slice(index + 1)]
}

function addresses(message: FetchMessageObject) {
  const list = (items: { name?: string; address?: string }[] | undefined) =>
    (items ?? [])
      .map((item) => (item.name && item.address ? `${item.name} <${item.address}>` : (item.address ?? "")))
      .join(", ")
  return {
    from: list(message.envelope?.from),
    to: list(message.envelope?.to),
    date: message.envelope?.date ? new Date(message.envelope.date).toISOString() : "",
  }
}

/** The message's text/plain part, else its HTML reduced to text; imapflow decodes transfer encoding and charset. */
async function bodyText(client: ImapFlow, message: FetchMessageObject) {
  const parts = flatten(message.bodyStructure)
  const pick = parts.find((part) => part.type === "text/plain") ?? parts.find((part) => part.type === "text/html")
  if (!pick) return ""
  const download = await client.download(String(message.uid), pick.part ?? "1", { uid: true, maxBytes: partLimit })
  const chunks: Buffer[] = []
  for await (const chunk of download.content) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString("utf8")
  return pick.type === "text/html" ? htmlToText(text) : text.trim()
}

function flatten(part: MessageStructureObject | undefined): MessageStructureObject[] {
  if (!part) return []
  return [part, ...(part.childNodes ?? []).flatMap(flatten)]
}
