import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { needsYou } from "@/pages/activity-runs"
import { lastAskText } from "@/features/command-centre/command-centre"

const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")
const strip = () => read("app/src/features/command-centre/command-strip.tsx")

const transcript = (messages: Array<{ id: string; role: "user" | "assistant"; text: string }>) =>
  ({
    message: {
      s1: messages.map((message) => ({
        id: message.id,
        role: message.role,
        sessionID: "s1",
        time: { created: 1, completed: 2 },
      })),
    },
    part: Object.fromEntries(
      messages.map((message) => [
        message.id,
        [{ id: `${message.id}p`, type: "text", text: message.text, messageID: message.id }],
      ]),
    ),
    part_text_accum_delta: {},
  }) as never

describe("needs you", () => {
  test("approvals and questions both count", () => {
    expect(needsYou({ permission: {}, question: {} } as never, "s1")).toBe(0)
    expect(needsYou({ permission: { s1: [{}] }, question: {} } as never, "s1")).toBe(1)
    expect(needsYou({ permission: {}, question: { s1: [{}, {}] } } as never, "s1")).toBe(2)
    expect(needsYou({ permission: { s1: [{}] }, question: { s1: [{}] } } as never, "s1")).toBe(2)
  })

  test("the sidebar, Home and the card use it", () => {
    expect(read("app/src/components/sidebar/sidebar-controller.ts")).toMatch(/threadState\([^)]*needsYou\(/)
    expect(read("app/src/pages/brain-home.tsx")).toMatch(/agentRunStatus\([^)]*needsYou\(/s)
    expect(read("app/src/features/command-centre/command-centre.tsx")).toMatch(/waiting: \(\) =>[\s\S]{0,80}needsYou\(/)
  })
})

describe("the card shows the exchange", () => {
  test("lastAskText is the thread's last user message on one line", () => {
    const data = transcript([
      { id: "m1", role: "user", text: "first" },
      { id: "m2", role: "assistant", text: "ok" },
      { id: "m3", role: "user", text: "Move the\nstandup to 9:30" },
      { id: "m4", role: "assistant", text: "Done" },
    ])
    expect(lastAskText(data, "s1")).toBe("Move the standup to 9:30")
    expect(lastAskText(data, undefined)).toBe("")
  })

  test("the strip renders the ask above the reply", () => {
    expect(strip()).toMatch(/centre\.lastAsk\(\)/)
    expect(strip()).toMatch(/data-slot="command-card-ask"/)
    expect(strip()).toMatch(/data-slot="command-card-reply"[^>]*line-clamp-3/)
  })
})

describe("replies and new threads", () => {
  test("the composer sends to the shown thread unless New thread was chosen", () => {
    const source = strip()
    expect(source).not.toMatch(/centre\.send\(text, null\)\)/)
    expect(source).toMatch(/centre\.send\(text, state\.fresh \? null : centre\.latest\(\)\?\.id\)/)
    expect(source).toMatch(/data-action="command-card-new"/)
  })

  test("the card's draft is the page's draft", () => {
    expect(strip()).toMatch(/persist: "command"/)
    expect(read("app/src/pages/command-centre.tsx")).toMatch(/persist: "command"/)
  })
})

describe("needs-you in the card", () => {
  test("waiting shows a Review in thread action", () => {
    expect(strip()).toMatch(/<Show when=\{centre\.waiting\(\)\}>[\s\S]{0,400}data-action="command-card-review"/)
    expect(read("app/src/i18n/en.ts")).toMatch(/"secondBrain\.commandCentre\.strip\.review": "Review in thread"/)
  })
})

describe("card shape", () => {
  test("identity, width and radius", () => {
    const source = strip()
    expect(source).toMatch(/w-\[min\(640px,/)
    expect(source).toMatch(/rounded-\[24px\] bg-v2-background-bg-floating/)
    expect(source).toMatch(/language\.t\("secondBrain\.commandCentre\.strip\.title"\)/)
  })
})
