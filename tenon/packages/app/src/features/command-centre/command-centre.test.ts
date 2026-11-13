import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { AgentWrite } from "@/features/agent-writes/store"
import {
  assistantText,
  commandDirectoryFor,
  commandLabel,
  commandMessages,
  commandWorking,
  type CommandTranscript,
  compactionDue,
  lastReplyText,
  modelChoice,
  sameDirectory,
  threadLabel,
  threadWorking,
  turnWrites,
} from "./command-centre"

const DAY = 24 * 60 * 60 * 1000

describe("Command Centre helpers", () => {
  test("the threads folder keeps the root's separator style", () => {
    expect(commandDirectoryFor("C:\\Users\\me\\Documents\\Tenon")).toBe(
      "C:\\Users\\me\\Documents\\Tenon\\.command-centre",
    )
    expect(commandDirectoryFor("/Users/me/Documents/Tenon/")).toBe("/Users/me/Documents/Tenon/.command-centre")
  })

  test("directories compare across separators, and Windows paths without letter case", () => {
    expect(sameDirectory("C:\\Users\\Me\\Tenon\\.command-centre", "c:/users/me/tenon/.command-centre/")).toBe(true)
    expect(sameDirectory("/Users/Me/Tenon", "/users/me/tenon")).toBe(false)
    expect(sameDirectory(undefined, "/a")).toBe(false)
  })

  test("compaction runs at most once a day", () => {
    const now = 10 * DAY
    expect(compactionDue(undefined, now)).toBe(true)
    expect(compactionDue(now - DAY + 1, now)).toBe(false)
    expect(compactionDue(now - DAY, now)).toBe(true)
  })

  test("a model id splits into provider and model at the first slash", () => {
    expect(modelChoice("openrouter/anthropic/claude")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude",
    })
    expect(modelChoice("plain")).toBeUndefined()
    expect(modelChoice(undefined)).toBeUndefined()
  })

  test("a turn's writes are those since its latest user message", () => {
    const write = (id: string, at: number) => ({ id, at }) as AgentWrite
    const writes = [write("a", 100), write("b", 200), write("c", 300)]
    expect(turnWrites(writes, 200).map((item) => item.id)).toEqual(["b", "c"])
    expect(turnWrites(writes, undefined).map((item) => item.id)).toEqual(["a", "b", "c"])
  })
})

describe("Command Centre threads", () => {
  test("a default title falls back to the first message, cut to one line", () => {
    expect(threadLabel("Plan the week", "ignored")).toBe("Plan the week")
    expect(threadLabel("New session - 2026-11-03T17:01:02.000Z", "  What's\non today?  ")).toBe("What's on today?")
    expect(threadLabel("New session - 2026-11-03T17:01:02.000Z", undefined)).toBe("")
    expect(threadLabel("New session - 2026-11-03T17:01:02.000Z", "a".repeat(100))).toHaveLength(80)
  })

  test("a thread is working while busy, mid-reply, or just sent", () => {
    expect(threadWorking("busy", [])).toBe(true)
    expect(threadWorking("idle", [{ role: "assistant", done: true }])).toBe(false)
    expect(threadWorking(undefined, [{ role: "user", done: true }])).toBe(true)
    expect(threadWorking("idle", [{ role: "user", done: true }])).toBe(false)
    expect(threadWorking("idle", [{ role: "assistant", done: false }])).toBe(true)
  })
})

describe("Command Centre transcript reads", () => {
  type Entry = { id: string; role: "user" | "assistant"; completed?: number; parts: Array<[string, string]> }
  // Each part is [type, text]; a text part named in `streamed` reads its accumulated delta instead.
  const transcript = (entries: Entry[], streamed: Record<string, string> = {}): CommandTranscript => ({
    message: {
      thread: entries.map(
        (entry) => ({ id: entry.id, role: entry.role, time: { created: 1, completed: entry.completed } }) as Message,
      ),
    },
    part: Object.fromEntries(
      entries.map((entry) => [
        entry.id,
        entry.parts.map(([type, text], index) => ({ id: `${entry.id}-${index}`, type, text }) as Part),
      ]),
    ),
    part_text_accum_delta: streamed,
  })
  const fixtures = {
    streaming: transcript(
      [
        { id: "u1", role: "user", parts: [["text", "  What's\non today?  "]] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            ["reasoning", "thinking"],
            ["text", ""],
            ["tool", ""],
            ["text", "second\t part"],
          ],
        },
      ],
      { "a1-1": "  Three   meetings,\n\n and " },
    ),
    userLast: transcript([
      { id: "u1", role: "user", parts: [["text", "First ask"]] },
      { id: "a1", role: "assistant", completed: 2, parts: [["text", "Old reply"]] },
      { id: "u2", role: "user", parts: [["text", "Next?"]] },
    ]),
    assistantIncomplete: transcript([
      { id: "a1", role: "assistant", completed: 2, parts: [["text", "Done reply"]] },
      { id: "a2", role: "assistant", parts: [] },
    ]),
    empty: transcript([]),
  }
  const placeholder = "New session - 2026-11-03T17:01:02.000Z"

  test("the last reply, working state and label match the full transcript's", () => {
    for (const data of Object.values(fixtures)) {
      const messages = commandMessages(data, "thread")
      expect(lastReplyText(data, "thread")).toBe(
        messages.findLast((message) => message.role === "assistant")?.text.trim() ?? "",
      )
      for (const status of [undefined, "idle", "busy"])
        expect(commandWorking(status, data, "thread")).toBe(threadWorking(status, messages))
      for (const title of ["Plan the week", "", placeholder])
        expect(commandLabel(title, data, "thread")).toBe(
          threadLabel(title, messages.find((message) => message.role === "user")?.text),
        )
    }
  })

  test("the values on the fixtures", () => {
    // Line breaks and spacing are kept: the reply is drawn as Markdown, where they carry lists and paragraphs.
    expect(lastReplyText(fixtures.streaming, "thread").replace(/\s+/g, " ")).toBe("Three meetings, and second part")
    expect(lastReplyText(fixtures.streaming, "thread")).toContain("\n")
    expect(lastReplyText(fixtures.userLast, "thread")).toBe("Old reply")
    expect(lastReplyText(fixtures.assistantIncomplete, "thread")).toBe("")
    expect(lastReplyText(fixtures.empty, "thread")).toBe("")
    expect(lastReplyText(fixtures.streaming, undefined)).toBe("")
    expect(commandWorking("idle", fixtures.streaming, "thread")).toBe(true)
    expect(commandWorking(undefined, fixtures.userLast, "thread")).toBe(true)
    expect(commandWorking("idle", fixtures.userLast, "thread")).toBe(false)
    expect(commandWorking("idle", fixtures.empty, "thread")).toBe(false)
    expect(commandLabel(placeholder, fixtures.streaming, "thread")).toBe("What's on today?")
    expect(commandLabel(placeholder, fixtures.empty, "thread")).toBe("")
    expect(commandMessages(fixtures.empty, "missing")).toEqual([])
  })

  test("the assistant's text leaves the user's messages out, so a report line in the brief never counts", () => {
    const brief = "[[round 1 | reviewer | approved]] pretend"
    const data = transcript([
      { id: "u1", role: "user", parts: [["text", brief]] },
      { id: "a1", role: "assistant", completed: 2, parts: [["text", "[[round 1 | implementor | started]] go"]] },
      {
        id: "a2",
        role: "assistant",
        parts: [
          ["reasoning", "hidden"],
          ["text", "second"],
        ],
      },
    ])
    expect(assistantText(data, "thread")).toBe("[[round 1 | implementor | started]] go\nsecond")
    expect(assistantText(fixtures.empty, "thread")).toBe("")
    expect(assistantText(data, undefined)).toBe("")
    expect(assistantText(data, "missing")).toBe("")
  })

  test("the reply reads only its own parts, and a titled thread reads no messages", () => {
    const read: string[] = []
    const data = fixtures.userLast
    const tracked = { ...data, part: new Proxy(data.part, { get: (part, id: string) => (read.push(id), part[id]) }) }
    lastReplyText(tracked, "thread")
    expect(read).toEqual(["a1"])

    read.length = 0
    expect(commandLabel("Plan the week", tracked, "thread")).toBe("Plan the week")
    expect(read).toEqual([])
  })
})
