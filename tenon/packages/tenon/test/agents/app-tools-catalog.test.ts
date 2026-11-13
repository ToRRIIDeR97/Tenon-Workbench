import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { AgentAppTools } from "../../src/agents/app-tools"

// AC-7.6 / AC-8.4: the in-process loop registers Command Centre-only tools only in the Command Centre's folder.

const root = path.resolve("vault-root-for-catalog-test")
const names = (directory: string) => AgentAppTools.catalogFor(directory).map((tool) => tool.name)

afterEach(() => {
  delete process.env.TENON_VAULT_DIR
  delete process.env.TENON_MAIL_URL
  delete process.env.TENON_MAIL_TOKEN
})

describe("AgentAppTools.catalogFor", () => {
  test("a Project folder gets only the app tools", () => {
    process.env.TENON_VAULT_DIR = root
    process.env.TENON_MAIL_URL = "http://127.0.0.1:9/mail"
    process.env.TENON_MAIL_TOKEN = "t"
    const project = names(path.resolve("some-workspace", "projects", "Acme"))
    expect(project).toContain("notes_write")
    for (const name of [
      "memory_search",
      "project_setup",
      "threads_overview",
      "thread_read",
      "thread_message",
      "thread_stop",
      "mail_search",
      "mail_read",
      "mail_draft",
    ])
      expect(project).not.toContain(name)
  })

  test("the Command Centre folder gets memory, setup and (with the endpoint) mail tools", () => {
    process.env.TENON_VAULT_DIR = root
    expect(names(path.join(root, ".command-centre"))).toEqual(
      expect.arrayContaining(["memory_search", "project_setup", "threads_overview", "thread_message", "thread_stop"]),
    )
    expect(names(path.join(root, ".command-centre"))).not.toContain("mail_search")
    process.env.TENON_MAIL_URL = "http://127.0.0.1:9/mail"
    process.env.TENON_MAIL_TOKEN = "t"
    expect(names(path.join(root, ".command-centre"))).toEqual(
      expect.arrayContaining(["mail_search", "mail_read", "mail_draft"]),
    )
  })
})

describe("AgentAppTools names", () => {
  // The threat model relies on this: nothing an agent can call approves, allows or answers a request.
  test("no tool answers a permission request or a question", () => {
    process.env.TENON_MAIL_URL = "http://127.0.0.1:9/mail"
    process.env.TENON_MAIL_TOKEN = "t"
    const names = [...AgentAppTools.TOOLS, ...AgentAppTools.COMMAND_TOOLS, ...AgentAppTools.catalog()].map(
      (tool) => tool.name,
    )
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => /approve|permission|allow|answer/i.test(name))).toEqual([])
  })
})

describe("AgentAppTools.distinctDirectories", () => {
  test("keeps each folder's first spelling, in the order they came", () => {
    const a = path.resolve("dedupe-root", "a")
    const b = path.resolve("dedupe-root", "b")
    expect(
      AgentAppTools.distinctDirectories([`${a}${path.sep}`, b, a, path.join(b, "..", "b"), path.dirname(a), b]),
    ).toEqual([`${a}${path.sep}`, b, path.dirname(a)])
  })
})
