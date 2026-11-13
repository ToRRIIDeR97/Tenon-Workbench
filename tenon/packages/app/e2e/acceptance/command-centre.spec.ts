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
    | "onPrompt"
    | "onAbort"
    | "onPermissionReply"
    | "commandActions"
    | "questions"
    | "pageMessages"
    | "children"
    | "sessions"
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

// implementations/command-centre-orchestrator/implementation.md, Task 3 (AC-3.3, AC-3.4): the Workflows view.
const harnessModel = (id: string, name: string, isDefault: boolean) => ({
  id,
  name,
  reasoningEfforts: [],
  serviceTiers: [],
  isDefault,
})
const workflowHarnesses = [
  {
    id: "claude-code",
    driver: "acp",
    name: "Claude Code",
    status: "available",
    authenticated: true,
    models: [harnessModel("fable-5-2", "Fable 5.2", true), harnessModel("opus-5-5", "Opus 5.5", false)],
  },
  {
    id: "codex",
    driver: "codex",
    name: "Codex",
    status: "available",
    models: [harnessModel("gpt-5.6-sol", "GPT-5.6 Sol", true)],
  },
]
const workflows = (page: Page) => page.locator('[data-component="workflows"]')
const roleCard = (page: Page, id: string) => workflows(page).locator(`[data-role="${id}"]`)
const problems = (page: Page) => workflows(page).locator('[data-slot="workflow-problems"]')

async function startWorkflows(page: Page, input: Parameters<typeof startBoard>[1] = {}) {
  await startBoard(page, input)
  // The same harness list the composer offers.
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: commandDirectory, project: { id: "global", directory: commandDirectory } },
        data: [
          { id: "opencode", driver: "opencode", name: "Default agent", status: "available", models: [] },
          ...workflowHarnesses,
        ],
      },
    }),
  )
  await page.locator('[data-action="command-view"]', { hasText: "Workflows" }).click()
  await expect(workflows(page)).toBeVisible()
}

test("AC-3.3 the Workflows view lists Build and review with a numbered card for each of its three roles", async ({
  page,
}) => {
  await startWorkflows(page)
  const item = workflows(page).locator('[data-workflow="build-and-review"]')
  await expect(item).toContainText("Build and review")
  await expect(item).toContainText("3 roles")
  await expect(workflows(page).getByRole("textbox", { name: "Workflow name" })).toHaveValue("Build and review")
  await expect
    .poll(() =>
      workflows(page)
        .locator("[data-role]")
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-role"))),
    )
    .toEqual(["director", "implementor", "reviewer"])
  await expect(roleCard(page, "director").getByRole("textbox", { name: "Role 1 name" })).toHaveValue("Director")
  await expect(roleCard(page, "director")).toContainText("Starts and steers the other roles, and never edits files.")
  await expect(roleCard(page, "implementor")).toContainText("Edits files and runs commands inside the Project.")
  await expect(roleCard(page, "reviewer")).toContainText("Reads files and runs tests, and never edits files.")
  // The built-in workflow can be duplicated but not deleted.
  await expect(workflows(page).locator('[data-action="workflow-duplicate"]')).toBeVisible()
  await expect(workflows(page).locator('[data-action="workflow-delete"]')).toHaveCount(0)
})

test("AC-3.3 Start is refused with a message while a role has no harness, and nothing is created", async ({ page }) => {
  const created: string[] = []
  await startWorkflows(page, { onSessionCreate: (input) => created.push(input.sessionID) })
  await workflows(page).locator('[data-slot="workflow-brief"]').fill("Replace the tab strip with a rail.")
  await workflows(page).locator('[data-action="workflow-project"]').click()
  await page.getByRole("menuitemradio", { name: "Repo project" }).click()
  // Only the director has a harness: the other two roles are still missing theirs.
  await roleCard(page, "director").locator('[data-action="workflow-role-harness"]').click()
  await page.getByRole("menuitemradio", { name: "Claude Code" }).click()
  await expect(problems(page).locator('[data-problem="role"]')).toHaveText(
    "Every role needs a name and a harness, and only one role may direct the others.",
  )
  await expect(problems(page).locator("[data-problem]")).toHaveCount(1)

  await workflows(page).locator('[data-action="workflow-start"]').click()
  await expect(problems(page).locator('[data-problem="role"]')).toHaveAttribute("role", "alert")
  await expect(workflows(page)).toBeVisible()
  expect(created).toEqual([])
  await expect(page).toHaveURL(/\/command$/)
})

test("AC-3.4 Start creates a director thread in the Project's folder, sends the brief and shows the board", async ({
  page,
}) => {
  const created: { sessionID: string; body: unknown }[] = []
  const prompts: { sessionID: string; text: string }[] = []
  await startWorkflows(page, {
    onSessionCreate: (input) => created.push({ sessionID: input.sessionID, body: input.body }),
    onPrompt: (input) => {
      const body = input.body as { prompt?: { text?: string }; parts?: { text?: string }[] }
      prompts.push({
        sessionID: input.sessionID,
        text: body.prompt?.text ?? body.parts?.map((part) => part.text ?? "").join("") ?? "",
      })
    },
  })
  const brief = "Replace the tab strip with a rail."
  const field = workflows(page).locator('[data-slot="workflow-brief"]')
  await expect(problems(page).locator("[data-problem]")).toHaveCount(3)

  // A radio choice leaves its menu open until the next menu opens, so each choice is looked up in its own menu.
  const choose = async (role: string, action: string, option: string) => {
    const trigger = roleCard(page, role).locator(`[data-action="${action}"]`)
    const label = await trigger.getAttribute("aria-label")
    await trigger.click()
    await page
      .getByRole("menu", { name: label!, exact: true })
      .getByRole("menuitemradio", { name: option, exact: true })
      .click()
    await expect(trigger).toContainText(option)
  }
  const pick = async (role: string, harness: string, name: string) => {
    await choose(role, "workflow-role-harness", harness)
    if (name) await choose(role, "workflow-role-model", name)
  }
  await pick("director", "Claude Code", "Fable 5.2")
  await pick("implementor", "Claude Code", "Opus 5.5")
  await pick("reviewer", "Codex", "")
  await field.fill(brief)
  await workflows(page).locator('[data-action="workflow-project"]').click()
  await page.getByRole("menuitemradio", { name: "Repo project" }).click()
  await expect(problems(page)).toHaveCount(0)

  await workflows(page).locator('[data-action="workflow-start"]').click()

  // One thread, in the Project's folder, on the director's harness and model.
  await expect.poll(() => created.length).toBe(1)
  expect(created[0]!.body).toMatchObject({
    harnessInstanceID: "claude-code",
    harnessModel: { id: "fable-5-2" },
    location: { directory: repo },
  })
  // Its first message is the generated brief, which carries the user's brief and the delegation tool.
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]!.sessionID).toBe(created[0]!.sessionID)
  expect(prompts[0]!.text).toContain("delegate_task")
  expect(prompts[0]!.text).toContain("opus-5-5")
  expect(prompts[0]!.text.trimEnd().endsWith(brief)).toBe(true)

  // The page stays on the Command Centre and shows the board.
  await expect(mission(page)).toBeVisible()
  await expect(workflows(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/command$/)
  // The run is recorded for the run view, running and without rounds.
  const runs = await page.evaluate(() => {
    const raw = Object.entries(localStorage).find(([key]) => key.endsWith("command-workflows.v1"))?.[1]
    return raw ? (JSON.parse(raw) as { runs: Record<string, unknown>[] }).runs : []
  })
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({
    workflowID: "build-and-review",
    sessionID: created[0]!.sessionID,
    project: "prj_repo",
    maxRounds: 3,
    status: "running",
    rounds: [],
  })
})

test("AC-3.3 a new workflow can be edited, survives a reload and can be deleted", async ({ page }) => {
  await startWorkflows(page)
  await workflows(page).locator('[data-action="workflow-new"]').click()
  await workflows(page).getByRole("textbox", { name: "Workflow name" }).fill("Plan only")
  await workflows(page).locator('[data-action="workflow-add-role"]').click()
  await expect(workflows(page).locator("[data-role]")).toHaveCount(2)
  await expect(workflows(page).locator("[data-workflow]", { hasText: "Plan only" })).toContainText("2 roles")

  await page.reload()
  await page.locator('[data-action="command-view"]', { hasText: "Workflows" }).click()
  const saved = workflows(page).locator("[data-workflow]", { hasText: "Plan only" })
  await expect(saved).toContainText("2 roles")
  await saved.click()
  await workflows(page).locator('[data-action="workflow-delete"]').click()
  await expect(workflows(page).locator("[data-workflow]", { hasText: "Plan only" })).toHaveCount(0)
  await expect(workflows(page).locator('[data-workflow="build-and-review"]')).toBeVisible()
})

// implementations/command-centre-orchestrator/implementation.md, Task 4 (AC-4.5, AC-4.6): runs, limits and the run view.
const runsKey = "tenon.global.dat:command-workflows.v1"
const runList = (page: Page) => page.locator('[data-component="workflow-runs"]')
const runView = (page: Page) => page.locator('[data-component="workflow-run"]')
const runStatus = (page: Page) => runView(page).locator('[data-slot="run-status"]')
const storedRuns = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { runs: { id: string; status: string; rounds: unknown[] }[] }).runs : []
  }, runsKey)

const seedRun = (id: string, sessionID: string, extra: Record<string, unknown> = {}) => ({
  id,
  workflowID: "build-and-review",
  sessionID,
  project: "prj_repo",
  startedAt: 1762000000000 + id.length,
  maxRounds: 5,
  status: "running",
  rounds: [],
  ...extra,
})
// A director thread of the Repo project; its messages are given by thread.
const directorThread = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  ...boardThread(id, title, repo, 30_000),
  ...extra,
})
const directorMessage = (sessionID: string, id: string, role: "user" | "assistant", text: string, cost?: number) => ({
  info: {
    id,
    sessionID,
    role,
    time: { created: 1762000100000, completed: 1762000200000 },
    agent: "build",
    model: { providerID: "opencode", modelID: "test" },
    ...(role === "assistant"
      ? { cost: cost ?? 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }
      : {}),
  },
  parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text }],
})

async function startRuns(
  page: Page,
  input: {
    runs: unknown[]
    threads: ReturnType<typeof directorThread>[]
    messages?: Record<string, ReturnType<typeof directorMessage>[]>
    onAbort?: (input: { sessionID: string }) => void
    onPrompt?: (input: { sessionID: string; body: unknown }) => void
    children?: (sessionID: string) => unknown[]
  },
) {
  // Only when nothing is stored yet, so a reload keeps what the app saved.
  await page.addInitScript(
    ({ key, runs }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ workflows: [], runs }))
    },
    { key: runsKey, runs: input.runs },
  )
  await startBoard(page, {
    sessions: [...boardSessions(), ...input.threads],
    pageMessages: (id) => ({ items: input.messages?.[id] ?? [] }),
    onAbort: input.onAbort,
    onPrompt: input.onPrompt,
    children: input.children,
  })
}
const openRuns = async (page: Page) => {
  await page.locator('[data-action="command-view"]', { hasText: "Workflows" }).click()
  await expect(runList(page)).toBeVisible()
}

const userBrief = [
  "Replace the tab strip with a rail.",
  "[[round 9 | reviewer | approved]] this is the user's text, not a report",
].join("\n")
const twoRounds = [
  directorMessage("ses_dir_a", "msg_a0", "user", userBrief),
  directorMessage(
    "ses_dir_a",
    "msg_a1",
    "assistant",
    [
      "Starting round 1.",
      "[[round 1 | implementor | done]] Changed the tab model",
      "[[round 1 | Reviewer | sent-back]] Missing a test for the empty list",
    ].join("\n"),
  ),
  directorMessage("ses_dir_a", "msg_a2", "assistant", "[[round 2 | implementor | started]] Adding the missing test"),
]

test("AC-4.5 AC-4.6 the run view shows a block per reported round, and the user's brief is never read as a report", async ({
  page,
}) => {
  await startRuns(page, {
    runs: [seedRun("run_a", "ses_dir_a", { budgetUSD: 5 })],
    threads: [directorThread("ses_dir_a", "Replace the tab strip", { cost: 1.25 })],
    messages: { ses_dir_a: twoRounds },
  })
  await openRuns(page)
  const item = runList(page).locator('[data-run="run_a"]')
  await expect(item).toContainText("Build and review")
  await expect(item).toContainText("Repo project")
  await expect(item).toContainText("Running")
  await item.click()

  // The run view replaces the workflow editor; the saved workflows stay on the left.
  await expect(runView(page)).toBeVisible()
  await expect(workflows(page).getByRole("textbox", { name: "Workflow name" })).toHaveCount(0)
  await expect(runView(page)).toContainText("Replace the tab strip")
  await expect(runView(page)).toContainText("Repo project")
  await expect(runView(page)).toContainText("Build and review")
  await expect(runStatus(page)).toHaveText("Running · round 2 of 5")
  await expect
    .poll(() =>
      runView(page)
        .locator("[data-round]")
        .evaluateAll((blocks) => blocks.map((block) => block.getAttribute("data-round"))),
    )
    .toEqual(["1", "2"])
  const first = runView(page).locator('[data-round="1"]')
  await expect(first).toContainText("Sent back")
  await expect(first).toContainText("implementor")
  await expect(first).toContainText("Changed the tab model")
  await expect(first).toContainText("reviewer")
  await expect(first).toContainText("Missing a test for the empty list")
  const second = runView(page).locator('[data-round="2"]')
  await expect(second).toContainText("In progress")
  await expect(second).toContainText("Adding the missing test")
  await expect(runView(page).locator('[data-round="9"]')).toHaveCount(0)

  // Rounds and spend against their limits, with a meter each, and the statement about the limits.
  await expect(runView(page).locator('[data-slot="run-rounds"]')).toContainText("2 of 5")
  await expect(runView(page).locator('[data-slot="run-rounds"]').getByRole("meter")).toHaveAttribute(
    "aria-valuenow",
    "40",
  )
  await expect(runView(page).locator('[data-slot="run-spend"]')).toContainText("$1.25 of $5.00")
  await expect(runView(page).locator('[data-slot="run-spend"]').getByRole("meter")).toHaveAttribute(
    "aria-valuenow",
    "25",
  )
  await expect(runView(page)).toContainText("Repeats until")
  await expect(runView(page)).toContainText("Limits are enforced while Tenon is open. A run never merges or pushes.")
  await expect(runView(page).locator('[data-action="run-pause"]')).toBeVisible()
  await expect(runView(page).locator('[data-action="run-stop"]')).toBeVisible()
  await expect(runView(page).locator('[data-action="run-resume"]')).toHaveCount(0)

  // The rounds are saved, so they survive a reload; the saved run is not replaced by the seeded one.
  await expect.poll(async () => (await storedRuns(page))[0]?.rounds.length).toBe(2)
  expect((await storedRuns(page))[0]?.status).toBe("running")
  await page.reload()
  await openRuns(page)
  await expect(runList(page).locator('[data-run="run_a"]')).toBeVisible()
  expect((await storedRuns(page))[0]?.rounds.length).toBe(2)

  // The director thread opens from the run view.
  await runList(page).locator('[data-run="run_a"]').click()
  await runView(page).locator('[data-action="run-open-thread"]').click()
  await expect(page).toHaveURL(/\/session\/ses_dir_a$/)
})

test("AC-4.5 a run whose reports pass its round cap is interrupted once and shows out of rounds", async ({ page }) => {
  const aborts: string[] = []
  await startRuns(page, {
    runs: [seedRun("run_b", "ses_dir_b", { maxRounds: 2 })],
    threads: [directorThread("ses_dir_b", "Rework the sidebar")],
    messages: {
      ses_dir_b: [
        directorMessage("ses_dir_b", "msg_b0", "user", "Rework the sidebar."),
        directorMessage(
          "ses_dir_b",
          "msg_b1",
          "assistant",
          "[[round 1 | implementor | done]] Done\n[[round 3 | implementor | started]] Again",
        ),
      ],
    },
    onAbort: (input) => aborts.push(input.sessionID),
  })
  await expect.poll(() => aborts).toEqual(["ses_dir_b"])
  await openRuns(page)
  await expect(runList(page).locator('[data-run="run_b"]')).toContainText("Out of rounds")
  await runList(page).locator('[data-run="run_b"]').click()
  await expect(runStatus(page)).toHaveText("Stopped · past 2 rounds")
  // A finished run offers the links and a way to remove it, not Pause or Stop.
  await expect(runView(page).locator('[data-action="run-open-thread"]')).toBeVisible()
  await expect(runView(page).locator('[data-action="run-pause"]')).toHaveCount(0)
  await expect(runView(page).locator('[data-action="run-stop"]')).toHaveCount(0)
  await expect.poll(async () => (await storedRuns(page))[0]?.status).toBe("out-of-rounds")
  expect(aborts).toEqual(["ses_dir_b"])

  await runView(page).locator('[data-action="run-remove"]').click()
  await expect(runView(page)).toHaveCount(0)
  await expect(runList(page)).toHaveCount(0)
  await expect.poll(async () => (await storedRuns(page)).length).toBe(0)
})

test("AC-4.5 a run is stopped when the director and its child threads have spent its budget", async ({ page }) => {
  const aborts: string[] = []
  const child = directorThread("ses_dir_d_child", "Implementor", { parentID: "ses_dir_d", cost: 2 })
  await startRuns(page, {
    runs: [seedRun("run_d", "ses_dir_d", { budgetUSD: 2 })],
    threads: [directorThread("ses_dir_d", "Tidy the settings", { cost: 0.5 }), child],
    children: (id) => (id === "ses_dir_d" ? [child] : []),
    onAbort: (input) => aborts.push(input.sessionID),
  })
  await expect.poll(() => aborts).toEqual(["ses_dir_d"])
  await openRuns(page)
  await runList(page).locator('[data-run="run_d"]').click()
  await expect(runStatus(page)).toHaveText("Stopped · over budget")
  await expect(runView(page).locator('[data-slot="run-spend"]')).toContainText("$2.50 of $2.00")
  expect(aborts).toEqual(["ses_dir_d"])
})

test("AC-4.6 Pause interrupts the director, Resume sends it on, and Stop interrupts and ends the run", async ({
  page,
}) => {
  const aborts: string[] = []
  const prompts: { sessionID: string; text: string }[] = []
  await startRuns(page, {
    runs: [seedRun("run_c", "ses_dir_c")],
    threads: [directorThread("ses_dir_c", "Fix the date picker")],
    onAbort: (input) => aborts.push(input.sessionID),
    onPrompt: (input) => {
      const body = input.body as { prompt?: { text?: string }; parts?: { text?: string }[] }
      prompts.push({
        sessionID: input.sessionID,
        text: body.prompt?.text ?? body.parts?.map((part) => part.text ?? "").join("") ?? "",
      })
    },
  })
  await openRuns(page)
  await runList(page).locator('[data-run="run_c"]').click()
  await expect(runStatus(page)).toHaveText("Running · no report yet")
  await expect(runView(page).locator('[data-slot="run-rounds"]')).toContainText("0 of 5")
  // No budget: just the amount, and no meter.
  await expect(runView(page).locator('[data-slot="run-spend"]')).toContainText("$0.00")
  await expect(runView(page).locator('[data-slot="run-spend"]')).not.toContainText(" of ")
  await expect(runView(page).locator('[data-slot="run-spend"]').getByRole("meter")).toHaveCount(0)

  await runView(page).locator('[data-action="run-pause"]').click()
  await expect(runStatus(page)).toHaveText("Paused")
  expect(aborts).toEqual(["ses_dir_c"])
  await expect(runView(page).locator('[data-action="run-pause"]')).toHaveCount(0)

  await runView(page).locator('[data-action="run-resume"]').click()
  await expect(runStatus(page)).toHaveText("Running · no report yet")
  expect(prompts).toHaveLength(1)
  expect(prompts[0]!.sessionID).toBe("ses_dir_c")
  expect(prompts[0]!.text).toContain("paused")

  await runView(page).locator('[data-action="run-stop"]').click()
  await expect(runStatus(page)).toHaveText("Stopped")
  expect(aborts).toEqual(["ses_dir_c", "ses_dir_c"])
  await expect(runView(page).locator('[data-action="run-resume"]')).toHaveCount(0)
  await expect.poll(async () => (await storedRuns(page))[0]?.status).toBe("stopped")
})

test("AC-4.6 a director's board row shows its round and opens the run view, and the run links back to the board", async ({
  page,
}) => {
  await startRuns(page, {
    runs: [seedRun("run_a", "ses_dir_a")],
    threads: [directorThread("ses_dir_a", "Replace the tab strip")],
    messages: { ses_dir_a: twoRounds },
  })
  const row = mission(page).locator('[data-thread="ses_dir_a"]')
  await expect(row.locator('[data-slot="board-run-round"]')).toHaveText("Round 2 of 5")
  // A thread without a run has neither.
  await expect(mission(page).locator('[data-thread="ses_board_run"] [data-action="board-run"]')).toHaveCount(0)
  await row.locator('[data-action="board-run"]').click()
  await expect(runView(page)).toBeVisible()
  await expect(runStatus(page)).toHaveText("Running · round 2 of 5")

  await runView(page).locator('[data-action="run-open-project"]').click()
  await expect(mission(page)).toBeVisible()
  await expect(mission(page).locator('[data-project="prj_repo"]')).toBeVisible()
  await expect(runView(page)).toHaveCount(0)
})

test("AC-4.5 a resumed run reads its director's reports again", async ({ page }) => {
  await startRuns(page, {
    runs: [seedRun("run_p", "ses_dir_p", { status: "paused" })],
    threads: [directorThread("ses_dir_p", "Port the date picker")],
    messages: {
      ses_dir_p: [
        directorMessage("ses_dir_p", "msg_p0", "user", "Port the date picker."),
        directorMessage("ses_dir_p", "msg_p1", "assistant", "[[round 1 | implementor | done]] Ported the picker"),
      ],
    },
  })
  await openRuns(page)
  await runList(page).locator('[data-run="run_p"]').click()
  await expect(runStatus(page)).toHaveText("Paused")
  // A paused run is not followed: nothing is read until it runs again.
  await expect(runView(page).locator("[data-round]")).toHaveCount(0)

  await runView(page).locator('[data-action="run-resume"]').click()
  await expect(runStatus(page)).toHaveText("Running · round 1 of 5")
  await expect(runView(page).locator('[data-round="1"]')).toContainText("Ported the picker")
})

test("AC-4.5 a thread that reports no cost of its own is priced from its messages' costs", async ({ page }) => {
  const aborts: string[] = []
  await startRuns(page, {
    runs: [seedRun("run_e", "ses_dir_e", { budgetUSD: 3 })],
    threads: [directorThread("ses_dir_e", "Clean up the exports")],
    messages: {
      ses_dir_e: [
        directorMessage("ses_dir_e", "msg_e0", "user", "Clean up the exports."),
        directorMessage("ses_dir_e", "msg_e1", "assistant", "Working on it.", 4),
      ],
    },
    onAbort: (input) => aborts.push(input.sessionID),
  })
  await expect.poll(() => aborts).toEqual(["ses_dir_e"])
  await openRuns(page)
  await runList(page).locator('[data-run="run_e"]').click()
  await expect(runStatus(page)).toHaveText("Stopped · over budget")
  await expect(runView(page).locator('[data-slot="run-spend"]')).toContainText("$4.00 of $3.00")
})

test("AC-4.6 a budget with no cost reported says so instead of showing $0, and the run is not stopped", async ({
  page,
}) => {
  const aborts: string[] = []
  await startRuns(page, {
    runs: [seedRun("run_f", "ses_dir_f", { budgetUSD: 3 })],
    threads: [directorThread("ses_dir_f", "Write the changelog")],
    messages: {
      ses_dir_f: [directorMessage("ses_dir_f", "msg_f1", "assistant", "[[round 1 | implementor | started]] Writing")],
    },
    onAbort: (input) => aborts.push(input.sessionID),
  })
  await openRuns(page)
  await runList(page).locator('[data-run="run_f"]').click()
  const spend = runView(page).locator('[data-slot="run-spend"]')
  await expect(spend).toContainText("Not reported")
  await expect(spend).toContainText("The budget cannot be enforced for this run.")
  await expect(spend).not.toContainText("$")
  await expect(spend.getByRole("meter")).toHaveCount(0)
  // The reports are still read: the run itself is following along.
  await expect(runStatus(page)).toHaveText("Running · round 1 of 5")
  expect(aborts).toEqual([])
})
