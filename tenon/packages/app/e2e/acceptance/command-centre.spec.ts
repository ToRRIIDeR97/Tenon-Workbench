import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@tenon/core/util/encode"
import { brain, openApp, sidebar } from "./open-app"

// P7 · Command Centre (implementations/notes-command-centre/implementation.md, AC-7.1, AC-7.2, AC-7.3, AC-7.4, AC-7.7)

const vaultRoot = "C:/Users/me/Documents/Tenon"
const commandDirectory = `${vaultRoot}/.command-centre`
const commandThread = {
  id: "ses_command_1",
  slug: "ses_command_1",
  projectID: "global",
  directory: commandDirectory,
  title: "Plan the billing webhook work",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000300000 },
}
const projectThread = {
  id: "ses_project_1",
  slug: "ses_project_1",
  projectID: "proj_acme",
  directory: `${brain}/projects/Acme`,
  title: "Cookie migration",
  version: "dev",
  time: { created: 1762000000000, updated: 1762000000000 },
}

async function start(page: Page, events: unknown[] = [], input: Parameters<typeof openApp>[1] = {}) {
  await openApp(page, {
    sessions: [commandThread, projectThread],
    events: () => events.splice(0, 1),
    eventRetry: 16,
    ...input,
  })
  await page.route("**/second-brain/vault", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ root: vaultRoot, workspace: { id: "ws", name: "brain", folder: "brain" } }),
    }),
  )
}
const strip = (page: Page) => page.locator("[data-command-strip]")
// The app picks Ctrl or Cmd from navigator.platform, which the "Desktop Chrome" device reports as Win32 on any host.
const toggleStrip = async (page: Page) => {
  const mac = await page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
  await page.keyboard.press(mac ? "Meta+j" : "Control+j")
}

test.use({ viewport: { width: 1360, height: 860 } })

test("AC-7.1 the rail's fourth destination is Command Centre and /activity redirects", async ({ page }) => {
  await start(page)
  await page.goto("/")
  const ids = await sidebar(page)
    .locator("nav [data-sidebar-item]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-sidebar-item")))
  expect(ids).toEqual(["overview", "projects", "calendar", "command", "settings"])
  await sidebar(page).locator('[data-sidebar-item="command"]').click()
  await expect(page).toHaveURL(/\/command$/)
  await page.goto("/activity")
  await expect(page).toHaveURL(/\/command$/)
})

test("AC-7.2 the Command Centre lists only its own threads", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await expect(page.getByText("Plan the billing webhook work")).toBeVisible()
  await expect(page.getByRole("list", { name: "Command Centre threads" }).getByText("Cookie migration")).toHaveCount(0)
  await page.goto("/")
  await expect(sidebar(page).getByText("Plan the billing webhook work")).toHaveCount(0)
})

// implementations/command-centre-thread/implementation.md, AC-2 and AC-3
const threadURL = new RegExp(`/session/${commandThread.id}$`)

test("AC-3 a Command Centre thread opens in the thread view, as do older ?thread= links", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await page.getByRole("link", { name: /Plan the billing webhook work/ }).click()
  await expect(page).toHaveURL(threadURL)
  await page.goto(`/command?thread=${commandThread.id}`)
  await expect(page).toHaveURL(threadURL)
})

test("AC-3 the Command Centre composer has the model pill", async ({ page }) => {
  await start(page)
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: commandDirectory, project: { id: "global", directory: commandDirectory } },
        data: [{ id: "opencode", driver: "opencode", name: "Default agent", status: "available", models: [] }],
      },
    }),
  )
  await page.goto("/command")
  await expect(page.getByRole("textbox", { name: "Message the Command Centre", exact: true })).toBeVisible()
  await expect(page.locator('[data-action="prompt-model-pill"]')).toBeVisible()
})

test("AC-2 a Command Centre thread has no review or terminal controls", async ({ page }) => {
  await start(page)
  await page.goto(`/command?thread=${commandThread.id}`)
  await expect(page).toHaveURL(threadURL)
  await expect(page.locator('[data-component="prompt-input-v2"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Toggle terminal", exact: true })).toHaveCount(0)
})

test("AC-7.3 Ctrl/Cmd+J toggles the slim strip; Esc hides it; Open full goes to the thread", async ({ page }) => {
  await start(page)
  await page.goto("/calendar")
  await expect(strip(page)).toHaveAttribute("data-state", "closed")
  const closed = await strip(page).evaluate((element) => element.getBoundingClientRect().height)
  expect(closed).toBeLessThanOrEqual(24)
  await toggleStrip(page)
  await expect(strip(page)).toHaveAttribute("data-state", "open")
  await expect
    .poll(() => strip(page).evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThanOrEqual(90)
  await expect(strip(page).getByRole("textbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(strip(page)).toHaveAttribute("data-state", "closed")
  await toggleStrip(page)
  await strip(page).getByRole("button", { name: "Open full" }).click()
  await expect(page).toHaveURL(threadURL)
})

// One exchange in the Command Centre thread; the reply is Markdown with a list long enough to pass the card's cap.
const tasks = [
  "Duolingo",
  "Read Bible",
  "Buy tickets",
  "Call the bank",
  "Water plants",
  "File receipts",
  "Book dentist",
]
const exchange = [
  message("msg_command_ask", "user", "What's on my calendar today?"),
  message(
    "msg_command_reply",
    "assistant",
    ["You have no calendar events today. Tasks due:", "", ...tasks.map((task) => `- **${task}**: still open`)].join(
      "\n",
    ),
  ),
]

function message(id: string, role: "user" | "assistant", text: string) {
  return {
    info: {
      id,
      sessionID: commandThread.id,
      role,
      time: { created: 1762000100000, completed: 1762000200000 },
      agent: "build",
      model: { providerID: "opencode", modelID: "test" },
    },
    parts: [{ id: `prt_${id}`, sessionID: commandThread.id, messageID: id, type: "text", text }],
  }
}

test("the card draws the reply as Markdown under a cap, with Show more", async ({ page }) => {
  await start(page, [], { pageMessages: (id) => ({ items: id === commandThread.id ? exchange : [] }) })
  await page.goto("/")
  await toggleStrip(page)
  await expect(strip(page)).toHaveAttribute("data-state", "open")

  const reply = strip(page).locator('[data-slot="command-card-reply"]')
  await expect(reply.getByRole("listitem")).toHaveCount(tasks.length)
  await expect(reply.locator("strong").filter({ hasText: "Duolingo" })).toHaveCount(1)
  await expect(reply).not.toContainText("**")

  const capped = await reply.evaluate((element) => element.getBoundingClientRect().height)
  await strip(page).getByRole("button", { name: "Show more", exact: true }).click()
  await expect(reply).toHaveAttribute("data-expanded", "")
  await expect(strip(page).getByRole("button", { name: "Show less", exact: true })).toBeVisible()
  await expect.poll(() => reply.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(capped)
})

test("AC-7.3 the strip is not offered on the Command Centre page itself", async ({ page }) => {
  await start(page)
  await page.goto("/command")
  await toggleStrip(page)
  await expect(strip(page)).toHaveCount(0)
})

test("AC-7.3 the strip animates with the motion tokens", async ({ page }) => {
  await start(page)
  await page.goto("/projects")
  await toggleStrip(page)
  const opening = await strip(page)
    .locator("[data-command-strip-card]")
    .evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(opening).toContain("0.3s")
})

test("AC-7.4 memory age defaults to 45 days and lowering it warns", async ({ page }) => {
  await start(page)
  await page.goto("/")
  await sidebar(page).locator('[data-sidebar-item="settings"]').click()
  await page.getByRole("tab", { name: "Command Centre" }).click()
  const days = page.getByRole("spinbutton", { name: "Delete threads after (days)" })
  await expect(days).toHaveValue("45")
  await days.fill("10")
  await expect(page.getByText("Threads older than this are summarised and deleted for good.")).toBeVisible()
})

test("AC-7.7 a Command Centre thread shows its writes as inline cards in the thread view", async ({ page }) => {
  const write = (id: string, kind: string, phase: string) => ({
    directory: commandDirectory,
    payload: {
      id: `evt_${id}_${phase}`,
      type: "agent.write",
      properties: {
        id,
        sessionID: commandThread.id,
        kind,
        phase,
        target: "Acme API",
        preview: kind === "note" ? { title: "Plan", text: "Write it up" } : { tasks: [{ title: "Webhook retries" }] },
        ...(phase === "done" ? { undo: `undo_${id}` } : {}),
      },
    },
  })
  await start(page, [
    write("a", "note", "started"),
    write("a", "note", "done"),
    write("b", "tasks", "started"),
    write("b", "tasks", "done"),
  ])
  // Open the thread view first: on any other page these writes would rightly show the top pill.
  await page.goto(`/${base64Encode(commandDirectory)}/session/${commandThread.id}`)
  await expect(page).toHaveURL(threadURL)
  // The thread view shows each write in its turn, as for a Project thread; never also as the top pill.
  const cards = page.locator('[data-agent-write][data-variant="inline"]')
  await expect(cards).toHaveCount(2)
  expect(await page.locator('[data-agent-write][data-variant="pill"]').count()).toBe(0)
})

// implementations/command-centre-orchestrator/implementation.md, Task 1 (AC-1.4 to AC-1.6): the mission board.
const repo = "C:/OpenCode/Repo"
const boardProject = {
  project: {
    id: "prj_repo",
    folder: "projects/prj_repo",
    name: "Repo project",
    outcome: "Ship it",
    instructions: "",
    status: "active",
    progressPercent: 0,
    tags: [],
    location: { workspaceId: "proj_repo", displayPath: repo },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  threadDirectory: repo,
  threadDirectoryKind: "workspace",
  workspace: { id: "proj_repo", worktree: repo },
  rootSessionCount: 3,
  lastActivityAt: null,
}
const boardThread = (id: string, title: string, directory: string, age: number) => ({
  id,
  slug: id,
  projectID: "proj_repo",
  directory,
  title,
  version: "dev",
  time: { created: Date.now() - age, updated: Date.now() - age },
})
const hour = 3_600_000
const boardSessions = () => [
  commandThread,
  boardThread("ses_board_run", "Migrate the billing webhook", repo, 60_000),
  boardThread("ses_board_need", "Rotate the API keys", repo, 2 * hour),
  boardThread("ses_board_done", "Draft the release notes", brain, 3 * hour),
  boardThread("ses_board_old", "Archive the 2025 invoices", repo, 3 * 24 * hour),
]
const boardPermission = {
  id: "per_board_need",
  sessionID: "ses_board_need",
  permission: "bash",
  patterns: ["git status"],
  metadata: {},
  always: [],
}
const mission = (page: Page) => page.locator('[data-component="mission-board"]')
const group = (page: Page, name: string) => mission(page).locator(`[data-group="${name}"]`)
const threadIDs = (scope: ReturnType<typeof group>) =>
  scope.locator("[data-thread]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-thread")))

async function startBoard(
  page: Page,
  input: Pick<
    Parameters<typeof openApp>[1],
    "onPrompt" | "onAbort" | "onPermissionReply" | "commandActions" | "questions"
  > = {},
) {
  await start(page, [], {
    sessions: boardSessions(),
    projectThreads: [boardProject],
    sessionStatus: { ses_board_run: { type: "busy" } },
    permissions: [boardPermission],
    ...input,
  })
  await page.goto("/command")
  await expect(mission(page)).toBeVisible()
}

test("AC-1.4 the board lists every Project's recent threads by state, beside the thread list and composer", async ({
  page,
}) => {
  await startBoard(page)
  await expect.poll(() => threadIDs(group(page, "needs-you"))).toEqual(["ses_board_need"])
  await expect.poll(() => threadIDs(group(page, "running"))).toEqual(["ses_board_run"])
  await expect.poll(() => threadIDs(group(page, "finished"))).toEqual(["ses_board_done"])
  await expect(mission(page).locator('[data-thread="ses_board_old"]')).toHaveCount(0)
  await expect(mission(page).locator('[data-thread="ses_command_1"]')).toHaveCount(0)
  await expect(group(page, "running").getByText("Migrate the billing webhook")).toBeVisible()

  // The Command Centre's own thread list, memory search and composer stay on the page.
  await expect(page.getByRole("list", { name: "Command Centre threads" }).getByText(commandThread.title)).toBeVisible()
  await expect(page.getByRole("searchbox", { name: "Search memory" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Message the Command Centre", exact: true })).toBeVisible()

  // By project: one section per Project, General last, each row keeping its state.
  await mission(page).locator('[data-action="board-view"]', { hasText: "By project" }).click()
  await expect
    .poll(() =>
      mission(page)
        .locator("[data-project]")
        .evaluateAll((items) => items.map((item) => item.getAttribute("data-project"))),
    )
    .toEqual(["prj_repo", "general"])
  await expect
    .poll(() => threadIDs(mission(page).locator('[data-project="prj_repo"]')))
    .toEqual(["ses_board_need", "ses_board_run"])
  await expect(mission(page).locator('[data-project="general"] [data-thread="ses_board_done"]')).toBeVisible()
})

test("AC-1.5 Steer sends one line to that thread, an empty line sends nothing, and Stop aborts it", async ({
  page,
}) => {
  const prompts: { sessionID: string; text: string }[] = []
  const aborts: string[] = []
  await startBoard(page, {
    onPrompt: (input) => {
      const parts = (input.body as { parts?: { type: string; text?: string }[] }).parts ?? []
      prompts.push({ sessionID: input.sessionID, text: parts.map((part) => part.text ?? "").join("") })
    },
    onAbort: (input) => aborts.push(input.sessionID),
  })
  const row = mission(page).locator('[data-thread="ses_board_run"]')
  await expect(row.locator('[data-action="board-steer"]')).toBeVisible()
  await expect(row.locator('[data-action="board-stop"]')).toBeVisible()
  // Only a running row can be steered or stopped.
  await expect(mission(page).locator('[data-thread="ses_board_need"] [data-action="board-steer"]')).toHaveCount(0)
  await expect(mission(page).locator('[data-thread="ses_board_done"] [data-action="board-stop"]')).toHaveCount(0)

  await row.locator('[data-action="board-steer"]').click()
  const field = row.getByRole("textbox", { name: "Steer Migrate the billing webhook" })
  await expect(field).toBeFocused()
  await field.fill("   ")
  await field.press("Enter")
  await expect(field).toBeVisible()
  expect(prompts).toEqual([])

  await field.fill("  run the tests first  ")
  await field.press("Enter")
  await expect.poll(() => prompts).toEqual([{ sessionID: "ses_board_run", text: "run the tests first" }])
  await expect(field).toHaveCount(0)
  await expect(page).toHaveURL(/\/command$/)

  await row.locator('[data-action="board-stop"]').click()
  await expect.poll(() => aborts).toEqual(["ses_board_run"])
  await expect(page).toHaveURL(/\/command$/)
})

test("AC-1.5 a failed Stop shows the request-failed message on the row", async ({ page }) => {
  await startBoard(page)
  await page.route("**/session/ses_board_run/abort**", (route) => route.fulfill({ status: 500, body: "{}" }))
  const row = mission(page).locator('[data-thread="ses_board_run"]')
  await row.locator('[data-action="board-stop"]').click()
  await expect(row.getByRole("alert")).toHaveText("Request failed")
})

test("AC-1.6 Review and Open go to the thread", async ({ page }) => {
  await startBoard(page)
  const needs = mission(page).locator('[data-thread="ses_board_need"]')
  await expect(needs.locator('[data-action="board-review"]')).toBeVisible()
  await expect(mission(page).locator('[data-thread="ses_board_run"] [data-action="board-review"]')).toHaveCount(0)
  await needs.locator('[data-action="board-review"]').click()
  await expect(page).toHaveURL(/\/session\/ses_board_need$/)

  await page.goto("/command")
  await mission(page).locator('[data-thread="ses_board_done"] [data-action="board-open"]').click()
  await expect(page).toHaveURL(/\/session\/ses_board_done$/)
})

// implementations/command-centre-orchestrator/implementation.md, Task 2 (AC-2.6, AC-2.7): the "Waiting on you" view.
const queue = (page: Page) => page.locator('[data-component="approval-queue"]')
const doneLog = (page: Page) => page.locator('[data-component="command-actions"]')
const waitingView = (page: Page) => page.locator('[data-action="command-view"]', { hasText: "Waiting on you" })
const boardQuestion = {
  id: "que_board_run",
  sessionID: "ses_board_run",
  questions: [{ question: "Which environment should the webhook migration use?", header: "Environment", options: [] }],
}

test("AC-2.6 a pending permission of a Project thread is in the queue and Allow once answers that request", async ({
  page,
}) => {
  const replies: { sessionID: string; requestID: string; body: unknown }[] = []
  await startBoard(page, {
    onPermissionReply: (input) =>
      replies.push({ sessionID: input.sessionID, requestID: input.requestID, body: input.body }),
  })
  await waitingView(page).click()
  const card = queue(page).locator('[data-request="per_board_need"]')
  await expect(card).toBeVisible()
  await expect(card.getByRole("heading", { name: "Rotate the API keys wants permission" })).toBeVisible()
  await expect(card).toContainText("Repo project")
  await expect(card.locator("code")).toHaveText("git status")
  await expect(queue(page).locator("[data-request]")).toHaveCount(1)
  await expect(card.locator('[data-action="queue-allow-once"]')).toBeVisible()
  await expect(card.locator('[data-action="queue-allow-always"]')).toBeVisible()
  await expect(card.locator('[data-action="queue-deny"]')).toBeVisible()

  await card.locator('[data-action="queue-allow-once"]').click()
  await expect
    .poll(() => replies.map((reply) => [reply.sessionID, reply.requestID]))
    .toEqual([["ses_board_need", "per_board_need"]])
  expect(JSON.stringify(replies[0]!.body)).toContain("once")
  // Answering removes the item; the page stays where it was.
  await expect(card).toHaveCount(0)
  await expect(queue(page)).toContainText("Nothing is waiting on you.")
  await expect(page).toHaveURL(/\/command$/)
})

test("AC-2.6 Deny sends its own reply, and a question item opens its thread", async ({ page }) => {
  const replies: string[] = []
  await startBoard(page, {
    questions: [boardQuestion],
    onPermissionReply: (input) => replies.push(JSON.stringify(input.body)),
  })
  await waitingView(page).click()
  const question = queue(page).locator('[data-request="que_board_run"]')
  await expect(question).toContainText("Which environment should the webhook migration use?")
  await expect(question.locator('[data-action="queue-allow-once"]')).toHaveCount(0)
  await expect(question.locator('[data-action="queue-deny"]')).toHaveCount(0)

  await queue(page).locator('[data-request="per_board_need"] [data-action="queue-deny"]').click()
  await expect.poll(() => replies.length).toBe(1)
  expect(replies[0]).toContain("reject")
  await expect(queue(page).locator('[data-request="per_board_need"]')).toHaveCount(0)

  await question.locator('[data-action="queue-open"]').click()
  await expect(page).toHaveURL(/\/session\/ses_board_run$/)
})

test("AC-2.7 the view lists today's actions of the agent with Open, and each Project's permission mode", async ({
  page,
}) => {
  await startBoard(page, {
    commandActions: () => [
      {
        id: "act_stop",
        at: Date.now() - 60_000,
        kind: "stop",
        sessionID: "ses_board_run",
        title: "Migrate the billing webhook",
        project: "Repo project",
        by: commandThread.id,
      },
      {
        id: "act_message",
        at: Date.now() - 600_000,
        kind: "message",
        sessionID: "ses_board_need",
        title: "Rotate the API keys",
        project: "Repo project",
        text: "Use the staging vault only.",
        by: commandThread.id,
      },
    ],
  })
  await waitingView(page).click()
  await expect
    .poll(() =>
      doneLog(page)
        .locator("[data-action-entry]")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-action-entry"))),
    )
    .toEqual(["act_stop", "act_message"])
  const stop = doneLog(page).locator('[data-action-entry="act_stop"]')
  await expect(stop).toContainText("Stopped")
  await expect(stop).toContainText("Migrate the billing webhook")
  const message = doneLog(page).locator('[data-action-entry="act_message"]')
  await expect(message).toContainText("Steered")
  await expect(message).toContainText("Use the staging vault only.")

  // Each Project shows its permission mode, with the control that changes it.
  const mode = page.locator('[data-component="project-modes"] [data-project-mode="prj_repo"]')
  await expect(mode).toContainText("Repo project")
  const control = mode.getByRole("button", { name: "Permissions for Repo project" })
  await expect(control).toContainText("Ask")
  await control.click()
  await page.getByRole("menuitemradio", { name: /Full auto/ }).click()
  await expect(control).toContainText("Full auto")

  await message.locator('[data-action="command-action-open"]').click()
  await expect(page).toHaveURL(/\/session\/ses_board_need$/)
})
