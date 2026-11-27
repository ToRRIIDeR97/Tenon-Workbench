import { base64Encode } from "@tenon/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { currentSession, mockTenonServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/BackgroundTerminal"
const projectID = "proj_background_terminal"
const threadID = "ses_background_terminal"
const threadTitle = "Background terminal thread"
const terminalID = "pty_dev111"
const command = "bun run dev"

test.use({ viewport: { width: 1440, height: 900 } })

test("AC-11 an open agent terminal is a running task that Stop closes on its own", async ({ page }) => {
  const calls = { removed: [] as string[], aborted: [] as string[] }
  await setup(page, calls)
  await page.goto(sessionHref(threadID))
  await expectSessionTitle(page, threadTitle)

  const rail = page.locator('[data-component="session-side-rail"]')
  await rail.getByRole("tab", { name: "Background tasks" }).click()
  const panel = page.locator("#review-panel")
  const running = panel.locator('[data-slot="tasks-section"][data-section="running"]')
  const row = running.locator('[data-slot="task-row"]')
  await expect(row).toHaveCount(1)
  await expect(row).toHaveAttribute("data-kind", "command")
  await expect(row).toContainText(command)
  await expect(rail.getByLabel("Running: 1")).toBeVisible()

  await row.locator('[data-action="task-open"]').click()
  const detail = panel.locator('[data-slot="task-detail"]')
  await expect(detail).toContainText(command)
  await expect(detail.locator('[data-action="task-show-terminal"]')).toBeVisible()
  await expect(detail.locator('[data-slot="task-output"]')).toHaveCount(0)

  await detail.locator('[data-action="task-stop"]').click()
  await expect.poll(() => calls.removed).toEqual([terminalID])
  await expect(detail.locator('[data-action="task-stop"]')).toHaveCount(0)
  await expect(detail.locator('[data-action="task-show-terminal"]')).toHaveCount(0)

  await detail.locator('[data-action="tasks-back"]').click()
  await expect(running).toContainText("Nothing running in the background.")
  await expect(
    panel.locator('[data-slot="tasks-section"][data-section="finished"] [data-slot="task-row"]'),
  ).toHaveCount(1)
  await expect(rail.getByLabel("Running: 1")).toHaveCount(0)
  expect(calls.aborted).toEqual([])
})

async function setup(page: Page, calls: { removed: string[]; aborted: string[] }) {
  await mockTenonServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "background-terminal",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    sessions: [session()],
    pageMessages: (sessionID) => ({ items: sessionID === threadID ? threadMessages() : [] }),
    onAbort: (input) => calls.aborted.push(input.sessionID),
  })
  const port = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  const location = { directory, project: { id: projectID, directory } }
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
  await page.route(
    (url) => url.pathname === "/api/session" && url.port === port,
    (route) => route.fulfill(json({ data: [currentSession(session())], cursor: {} })),
  )
  await page.route(
    (url) => (url.pathname === "/api/pty" || url.pathname === "/pty") && url.port === port,
    (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      const open = calls.removed.includes(terminalID)
        ? []
        : [{ id: terminalID, title: "Dev server", status: "running", sessionID: threadID }]
      return route.fulfill(json(route.request().url().includes("/api/pty") ? { location, data: open } : open))
    },
  )
  await page.route(
    (url) => (url.pathname === `/api/pty/${terminalID}` || url.pathname === `/pty/${terminalID}`) && url.port === port,
    (route) => {
      if (route.request().method() !== "DELETE") return route.fallback()
      calls.removed.push(terminalID)
      return route.fulfill(json(route.request().url().includes("/api/pty") ? { location, data: true } : true))
    },
  )
  await page.addInitScript(
    (input) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: {} }))
      localStorage.setItem(
        "tenon.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: input.directory, expanded: true }] },
          lastProject: { local: input.directory },
        }),
      )
    },
    { directory },
  )
}

function session() {
  return {
    id: threadID,
    slug: threadID,
    projectID,
    directory,
    title: threadTitle,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function threadMessages() {
  const userID = "msg_0001_user"
  const assistantID = "msg_0002_assistant"
  return [
    {
      info: {
        id: userID,
        sessionID: threadID,
        role: "user",
        time: { created: 1700000000000 },
        agent: "build",
        model: { providerID: "opencode", modelID: "claude-opus-4-6" },
      },
      parts: [
        { id: "prt_0001_text", sessionID: threadID, messageID: userID, type: "text", text: "Start the dev server" },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID: threadID,
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000003000 },
        parentID: userID,
        modelID: "claude-opus-4-6",
        providerID: "opencode",
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0.01,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        {
          id: "prt_0002_terminal",
          sessionID: threadID,
          messageID: assistantID,
          type: "tool",
          callID: "call_terminal_0001",
          tool: "terminal_start",
          state: {
            status: "completed",
            input: { command, title: "Dev server" },
            output: JSON.stringify({ terminalId: terminalID, title: "Dev server", folder: directory }),
            title: "Dev server",
            metadata: {},
            time: { start: 1700000001000, end: 1700000001200 },
          },
        },
      ],
    },
  ]
}

function sessionHref(sessionID: string) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
