import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@opencode-ai/sdk/v2/client"
import {
  compareSessionTime,
  displayName,
  errorMessage,
  homeProjectDirectories,
  toggleHomeProjectSelection,
} from "./helpers"
import { pathKey } from "@/utils/path-key"
import { ServerConnection } from "@/context/server"

const serverKey = ServerConnection.Key.make

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("tenon://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("tenon://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("tenon://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("tenon://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("tenon://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("tenon://open-project")).toBeUndefined()
    expect(parseDeepLink("tenon://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "tenon://open-project?directory=/a",
      "tenon://other?directory=/b",
      "tenon://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("tenon://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("tenon://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("tenon://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("tenon://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "tenon://new-session?directory=/a",
      "tenon://open-project?directory=/b",
      "tenon://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __TENON__: {
        deepLinks: ["tenon://open-project?directory=/a"],
      },
    } as unknown as Window & { __TENON__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["tenon://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(String(pathKey("/tmp/demo///"))).toBe("/tmp/demo")
    expect(String(pathKey("C:\\tmp\\demo\\\\"))).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(String(pathKey("/"))).toBe("/")
    expect(String(pathKey("///"))).toBe("/")
    expect(String(pathKey("C:\\"))).toBe("C:/")
    expect(String(pathKey("C://"))).toBe("C:/")
    expect(String(pathKey("C:///"))).toBe("C:/")
  })

  test("sorts recent sessions by persisted update time instead of id", () => {
    const sessions = [
      session({ id: "ses_z", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
      session({ id: "ses_a", directory: "/workspace", time: { created: 1, updated: 3, archived: undefined } }),
    ]

    expect(sessions.sort(compareSessionTime).map((item) => item.id)).toEqual(["ses_a", "ses_z"])
  })

  test("uses id only to break equal session timestamps", () => {
    const sessions = [
      session({ id: "ses_z", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
      session({ id: "ses_a", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
    ]

    expect(sessions.sort(compareSessionTime).map((item) => item.id)).toEqual(["ses_a", "ses_z"])
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
    expect(displayName({ worktree: "/" })).toBe("/")
  })

  test("scopes home project selection by server", () => {
    expect(
      toggleHomeProjectSelection(undefined, serverKey("https://debian.example"), "/home/luke/repos/amazon"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      directory: "/home/luke/repos/amazon",
    })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://windows.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("preserves picker order when adding multiple projects", () => {
    expect(homeProjectDirectories(["/first", "/second"])).toEqual(["/first", "/second"])
    expect(homeProjectDirectories("/only")).toEqual(["/only"])
    expect(homeProjectDirectories(null)).toEqual([])
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
