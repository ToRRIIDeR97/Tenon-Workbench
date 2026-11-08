import { describe, expect, test } from "bun:test"
import {
  createGmailProvider,
  createGraphProvider,
  createImapProvider,
  GMAIL_SCOPES,
  GRAPH_SCOPES,
  saveImapPassword,
} from "./index"
import { imapOptions } from "./imap-client"

// P8 · Email (implementations/notes-command-centre/implementation.md, AC-8.1 … AC-8.3)

type Call = { url: string; method: string; body?: string }
const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url")

function fakeFetch(routes: (call: Call) => unknown) {
  const calls: Call[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    }
    calls.push(call)
    return Response.json(routes(call) ?? {})
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const noSend = (calls: Call[]) => {
  for (const call of calls) {
    expect(call.url).not.toMatch(/\/send\b|\/sendMail\b/i)
  }
}

test("IMAP without TLS requires STARTTLS, except on a loopback bridge", () => {
  const account = { port: 143, secure: false, user: "me", password: "app-password" }
  expect(imapOptions({ ...account, host: "mail.example.com" }).doSTARTTLS).toBe(true)
  for (const host of ["localhost", "127.0.0.1", "::1"])
    expect(imapOptions({ ...account, host }).doSTARTTLS).toBeUndefined()
  expect(imapOptions({ ...account, host: "mail.example.com", secure: true }).doSTARTTLS).toBeUndefined()
})

describe("Gmail", () => {
  const gmail = fakeFetch((call) => {
    if (call.url.includes("/messages?")) return { messages: [{ id: "m1", threadId: "t1" }] }
    if (call.url.includes("/messages/m1"))
      return {
        id: "m1",
        threadId: "t1",
        snippet: "Webhook signing secret rotates",
        payload: {
          headers: [
            { name: "Subject", value: "Secret rotation" },
            { name: "From", value: "Stripe <no-reply@stripe.com>" },
            { name: "Date", value: "Mon, 2 Nov 2026 09:00:00 +0000" },
          ],
        },
      }
    if (call.url.includes("/threads/t1"))
      return {
        id: "t1",
        messages: [
          {
            id: "m1",
            payload: {
              headers: [
                { name: "From", value: "Stripe <no-reply@stripe.com>" },
                { name: "To", value: "me@acme.dev" },
                { name: "Date", value: "Mon, 2 Nov 2026 09:00:00 +0000" },
              ],
              mimeType: "text/html",
              body: { data: b64url("<p>Your secret <b>rotates</b> on 20 Nov.</p>") },
            },
          },
        ],
      }
    if (call.url.includes("/drafts")) return { id: "d1", message: { id: "m9", threadId: "t1" } }
  })
  const provider = createGmailProvider({ fetch: gmail.fetch, accessToken: async () => "token" })

  test("AC-8.2 asks for read and compose scopes only", () => {
    expect([...GMAIL_SCOPES].sort()).toEqual([
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.readonly",
    ])
  })

  test("AC-8.3 search returns summaries", async () => {
    const results = await provider.search("secret")
    expect(results[0]).toMatchObject({
      id: "t1",
      subject: "Secret rotation",
      from: expect.stringContaining("stripe.com"),
      snippet: expect.stringContaining("signing secret"),
    })
  })

  test("AC-8.3 threads come back as text, not HTML", async () => {
    const thread = await provider.readThread("t1")
    expect(thread.messages[0].text).toContain("Your secret rotates on 20 Nov.")
    expect(thread.messages[0].text).not.toContain("<b>")
  })

  test("AC-8.1 drafts are created, never sent", async () => {
    const draft = await provider.createDraft({ to: "billing-team@acme.dev", subject: "Retries", body: "Hi team" })
    expect(draft.id).toBe("d1")
    const created = gmail.calls.find((call) => call.url.includes("/drafts") && call.method === "POST")
    expect(created).toBeDefined()
    noSend(gmail.calls)
  })
})

describe("Microsoft Graph", () => {
  const graph = fakeFetch((call) => {
    if (call.url.includes("/me/messages?") && call.url.includes("search"))
      return {
        value: [
          {
            id: "g1",
            conversationId: "c1",
            subject: "Invoice",
            from: { emailAddress: { name: "Vendor", address: "billing@vendor.com" } },
            receivedDateTime: "2026-11-02T08:00:00Z",
            bodyPreview: "Invoice attached",
          },
        ],
      }
    if (call.url.includes("conversationId"))
      return {
        value: [
          {
            id: "g1",
            from: { emailAddress: { name: "Vendor", address: "billing@vendor.com" } },
            toRecipients: [{ emailAddress: { address: "me@acme.dev" } }],
            receivedDateTime: "2026-11-02T08:00:00Z",
            body: { contentType: "html", content: "<div>Pay <i>by</i> Friday</div>" },
          },
        ],
      }
    if (call.url.endsWith("/me/messages") && call.method === "POST") return { id: "draft1", isDraft: true }
  })
  const provider = createGraphProvider({ fetch: graph.fetch, accessToken: async () => "token" })

  test("AC-8.2 asks for mail read, read-write and offline access", () => {
    expect([...GRAPH_SCOPES].sort()).toEqual(["Mail.Read", "Mail.ReadWrite", "offline_access"])
  })

  test("AC-8.3 search and thread parsing", async () => {
    const results = await provider.search("invoice")
    expect(results[0]).toMatchObject({
      id: "c1",
      subject: "Invoice",
      from: expect.stringContaining("billing@vendor.com"),
    })
    const thread = await provider.readThread("c1")
    expect(thread.messages[0].text).toContain("Pay by Friday")
  })

  test("AC-8.1 drafts are saved, never sent", async () => {
    const draft = await provider.createDraft({ to: "billing@vendor.com", subject: "Re: Invoice", body: "Thanks" })
    expect(draft.id).toBe("draft1")
    noSend(graph.calls)
  })
})

describe("IMAP", () => {
  test("AC-8.1 a draft is appended to Drafts with the Draft flag", async () => {
    const appended: { mailbox: string; flags: string[]; raw: string }[] = []
    const provider = createImapProvider({
      client: {
        search: async () => [],
        fetchThread: async () => ({ id: "x", messages: [] }),
        append: async (mailbox, raw, flags) => {
          appended.push({ mailbox, raw, flags })
          return { uid: 42 }
        },
      },
    })
    const draft = await provider.createDraft({ to: "a@b.c", subject: "Hello", body: "Body text" })
    expect(draft.id).toBe("42")
    expect(appended[0].mailbox).toMatch(/drafts/i)
    expect(appended[0].flags).toContain("\\Draft")
    expect(appended[0].raw).toContain("Subject: Hello")
  })

  test("AC-8.2 the app password is encrypted, and refused when encryption is unavailable", async () => {
    const stored: Record<string, string> = {}
    const write = async (key: string, value: string) => {
      stored[key] = value
    }
    const encrypting = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value: string) => Buffer.from(`enc:${value}`),
    }
    await saveImapPassword({ safeStorage: encrypting, write }, "acct1", "app-password")
    const saved = Object.values(stored).join("")
    expect(saved).not.toContain("app-password")

    const unavailable = {
      isAsyncEncryptionAvailable: async () => false,
      encryptStringAsync: async () => Buffer.from(""),
    }
    await expect(saveImapPassword({ safeStorage: unavailable, write }, "acct2", "app-password")).rejects.toThrow()
    expect(Object.keys(stored)).toHaveLength(1)
  })
})
