import { base64Encode } from "@tenon/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { currentSession, mockTenonServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/BackgroundTasks"
const projectID = "proj_background_tasks"
const threadID = "ses_background_thread"
const childID = "ses_background_child"
const threadTitle = "Background tasks thread"
const agentName = "Map the sync store"
const doneCommand = "bun run typecheck"
const liveCommand = "bun run test:engine"

test.use({ viewport: { width: 1440, height: 900 } })

test("AC-7 the rail opens Background tasks with running and finished rows", async ({ page }) => {
  await setup(page)
  const panel = await openTasks(page)

  await expect(panel.locator('[data-slot="side-panel-title"]')).toHaveText("Background tasks")
  await expect(rail(page).getByLabel("Running: 1")).toBeVisible()

  const running = panel.locator('[data-slot="tasks-section"][data-section="running"]')
  const finished = panel.locator('[data-slot="tasks-section"][data-section="finished"]')
  await expect(running.locator('[data-slot="task-row"]')).toHaveCount(1)
  await expect(running.locator('[data-slot="task-row"]')).toHaveAttribute("data-kind", "command")
  await expect(running.locator('[data-slot="task-row"]')).toContainText(liveCommand)
  await expect(running.locator('[data-slot="task-row"]')).toContainText("38 pass")
  await expect(finished.locator('[data-slot="task-row"]')).toHaveCount(2)
  await expect(finished.locator('[data-slot="task-row"][data-kind="agent"]')).toContainText(agentName)
  await expect(finished.locator('[data-slot="task-row"][data-kind="command"]')).toContainText(doneCommand)
  await expect(finished.locator('[data-slot="task-row"][data-kind="command"]')).toContainText("exit 0")
})

test("AC-7 the filters narrow the list to one kind", async ({ page }) => {
  await setup(page)
  const panel = await openTasks(page)
  const rows = panel.locator('[data-slot="task-row"]')
  await expect(rows).toHaveCount(3)

  await panel.getByRole("radio", { name: /^Agents/ }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toHaveAttribute("data-kind", "agent")
  await expect(panel.locator('[data-slot="tasks-section"][data-section="running"]')).toContainText(
    "Nothing running in the background.",
  )

  await panel.getByRole("radio", { name: /^Commands/ }).click()
  await expect(rows).toHaveCount(2)
  await expect(panel.locator('[data-slot="task-row"][data-kind="agent"]')).toHaveCount(0)

  await panel.getByRole("radio", { name: /^All/ }).click()
  await expect(rows).toHaveCount(3)
})

test("AC-7 a running command opens its output, and Stop interrupts the thread", async ({ page }) => {
  const aborts: string[] = []
  await setup(page, (sessionID) => aborts.push(sessionID))
  const panel = await openTasks(page)

  await panel.locator('[data-action="task-open"]').filter({ hasText: liveCommand }).click()
  const detail = panel.locator('[data-slot="task-detail"]')
  await expect(detail).toContainText(liveCommand)
  await expect(detail.locator('[data-slot="task-output"]')).toContainText("put retries once on 409")
  await expect(detail.locator('[data-slot="task-output"]')).toContainText("38 pass")
  await expect(panel.locator('[data-slot="task-row"]')).toHaveCount(0)

  await detail.locator('[data-action="task-stop"]').click()
  await expect.poll(() => aborts).toEqual([threadID])

  await detail.locator('[data-action="tasks-back"]').click()
  await expect(panel.locator('[data-slot="task-row"]')).toHaveCount(3)
  await expect(detail).toHaveCount(0)
})

test("AC-7 a finished command shows its output without Stop", async ({ page }) => {
  await setup(page)
  const panel = await openTasks(page)

  await panel.getByRole("button", { name: new RegExp(escape(doneCommand)) }).click()
  const detail = panel.locator('[data-slot="task-detail"]')
  await expect(detail.locator('[data-slot="task-output"]')).toContainText("Tasks: 14 successful")
  await expect(detail.locator('[data-action="task-stop"]')).toHaveCount(0)
})

test("AC-7 a subagent row opens the subagent's detail", async ({ page }) => {
  await setup(page)
  const panel = await openTasks(page)

  await panel.getByRole("button", { name: new RegExp(agentName) }).click()
  const detail = panel.locator('[data-slot="agents-tab-detail"]')
  await expect(detail.locator('[data-slot="agent-tab-heading"]')).toContainText(agentName)
  await expect(detail.locator('[data-action="agents-tab-open-session"]')).toBeVisible()

  await detail.locator('[data-action="agents-tab-back"]').click()
  await expect(panel.locator('[data-slot="task-row"]')).toHaveCount(3)
})

function rail(page: Page) {
  return page.locator('[data-component="session-side-rail"]')
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function openTasks(page: Page) {
  await page.goto(sessionHref(threadID))
  await expectSessionTitle(page, threadTitle)
  await rail(page).getByRole("tab", { name: "Background tasks" }).click()
  const panel = page.locator("#review-panel")
  await expect(panel.locator('[data-slot="tasks-list"]')).toBeVisible()
  return panel
}

async function setup(page: Page, onAbort?: (sessionID: string) => void) {
  await mockTenonServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "background-tasks",
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
    sessions: [
      session(threadID, threadTitle, 1700000000000),
      session(childID, agentName, 1700000001000, { parentID: threadID }),
    ],
    pageMessages: (sessionID) => ({ items: sessionID === threadID ? threadMessages() : [] }),
    onAbort: (input) => onAbort?.(input.sessionID),
  })
  await page.route(
    (url) => url.pathname === "/api/session" && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ data: [currentSession(session(threadID, threadTitle, 1700000000000))], cursor: {} }),
      }),
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

function session(id: string, title: string, created: number, extra?: Record<string, unknown>) {
  return { id, slug: id, projectID, directory, title, version: "dev", time: { created, updated: created }, ...extra }
}

function userMessage(id: string, created: number, text: string) {
  return {
    info: {
      id,
      sessionID: threadID,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    parts: [{ id: `prt_text_${id}`, sessionID: threadID, messageID: id, type: "text", text }],
  }
}

function assistantInfo(id: string, parentID: string, created: number, completed?: number) {
  return {
    id,
    sessionID: threadID,
    role: "assistant",
    time: completed === undefined ? { created } : { created, completed },
    parentID,
    modelID: "claude-opus-4-6",
    providerID: "opencode",
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(completed === undefined ? {} : { finish: "stop" }),
  }
}

function toolPart(id: string, messageID: string, tool: string, state: Record<string, unknown>) {
  return { id, sessionID: threadID, messageID, type: "tool", callID: `call_${id}`, tool, state }
}

function threadMessages() {
  return [
    userMessage("msg_0001_user", 1700000000000, "Check the types and map the sync store"),
    {
      info: assistantInfo("msg_0002_assistant", "msg_0001_user", 1700000001000, 1700000060000),
      parts: [
        toolPart("prt_0001_typecheck", "msg_0002_assistant", "bash", {
          status: "completed",
          input: { command: doneCommand },
          output: "$ turbo typecheck\nTasks: 14 successful, 14 total\n",
          title: doneCommand,
          metadata: { exit: 0 },
          time: { start: 1700000001000, end: 1700000049000 },
        }),
        toolPart("prt_0002_agent", "msg_0002_assistant", "task", {
          status: "completed",
          input: { description: agentName, subagent_type: "explore" },
          output: "Mapped the store",
          title: agentName,
          metadata: { sessionId: childID },
          time: { start: 1700000050000, end: 1700000059000 },
        }),
      ],
    },
    userMessage("msg_0003_user", 1700000070000, "Run the engine tests"),
    {
      info: assistantInfo("msg_0004_assistant", "msg_0003_user", 1700000071000),
      parts: [
        toolPart("prt_0003_tests", "msg_0004_assistant", "bash", {
          status: "running",
          input: { command: liveCommand },
          metadata: { output: "sync/drive-store.test.ts\n✓ put retries once on 409 (212ms)\n38 pass · 0 fail\n" },
          time: { start: 1700000072000 },
        }),
      ],
    },
  ]
}

function sessionHref(sessionID: string) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
