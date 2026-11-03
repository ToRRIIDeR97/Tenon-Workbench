import { expect, test, type Page } from "@playwright/test"
import { openApp } from "./open-app"

// P4 · Notes F (implementations/notes-command-centre/implementation.md, AC-4.1 … AC-4.6), as rebuilt by
// implementations/projects-one-page/implementation.md: no page tree, a Project is one page with sections.

const project = {
  project: {
    id: "project_01ACME",
    folder: ".tenon/projects/project_01ACME",
    name: "Acme API",
    outcome: "Ship it",
    instructions: "",
    status: "active",
    progressPercent: 0,
    tags: [],
    location: { workspaceId: "proj_acme", displayPath: "C:/dev/acme" },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  threadDirectory: "C:/dev/acme",
  threadDirectoryKind: "workspace",
  workspace: { id: "proj_acme", worktree: "C:/dev/acme" },
  rootSessionCount: 0,
  lastActivityAt: null,
}

const info = (path: string, title: string, projectId: string | null) => ({
  id: `page_${title.replaceAll(" ", "")}`,
  path,
  title,
  projectId,
  properties: {},
  updatedAt: "2026-11-01T10:00:00.000Z",
})
const pages = [
  info("Acme API/Auth redesign.md", "Auth redesign", project.project.id),
  info("Acme API/Billing notes.md", "Billing notes", project.project.id),
  info("Ideas.md", "Ideas", null),
]
const timeline = {
  projectId: project.project.id,
  revision: "t1",
  progress: 0.5,
  items: [
    { id: "auth", title: "Auth redesign", kind: "task", status: "doing", start: "2026-11-02", end: "2026-11-12" },
    { id: "rate", title: "Rate limiting", kind: "task", status: "done", start: "2026-11-02", end: "2026-11-05" },
    { id: "hooks", title: "Billing webhooks", kind: "task", status: "todo", start: "2026-11-10", end: "2026-11-28" },
    { id: "launch", title: "v2 launch", kind: "milestone", status: "todo", start: "2026-12-08" },
  ],
}
const log = [
  { at: "2026-11-02T10:42:00.000Z", author: "agent", text: "Token rotation finished", machine: "m1" },
  { at: "2026-11-01T09:00:00.000Z", author: "you", text: "Moved Billing webhooks", machine: "m1" },
]

type Captured = { method: string; path: string; body: unknown }

async function mockVault(page: Page, options: { conflicts?: unknown[]; conflictOnSave?: boolean } = {}) {
  const writes: Captured[] = []
  await page.route("**/second-brain/vault**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/second-brain/vault")
      return json({ root: "C:/Users/me/Documents/Tenon", workspace: { id: "ws1", name: "brain", folder: "brain" } })
    if (url.pathname === "/second-brain/vault/pages") {
      const projectId = url.searchParams.get("project")
      return json(projectId ? pages.filter((page) => page.projectId === projectId) : pages)
    }
    if (url.pathname === "/second-brain/vault/page" && request.method() === "GET") {
      const path = url.searchParams.get("path")!
      const found = pages.find((page) => page.path === path) ?? info(path, path.replace(/\.md$/, ""), null)
      return json({ info: found, body: `# ${found.title}\n\nBody of ${found.title}.`, revision: "r1" })
    }
    if (url.pathname === "/second-brain/vault/page" && request.method() === "PUT") {
      const body = request.postDataJSON()
      writes.push({ method: "PUT", path: url.searchParams.get("path")!, body })
      if (options.conflictOnSave && !body.create) return json({ data: { message: "conflict" } }, 409)
      const path = url.searchParams.get("path")!
      return json({ info: info(path, body.title ?? "Untitled", body.projectId ?? null), body: body.body, revision: "r2" })
    }
    if (url.pathname === "/second-brain/vault/timeline" && request.method() === "PUT") {
      const body = request.postDataJSON()
      writes.push({ method: "PUT", path: "timeline", body })
      return json({ ...timeline, revision: "t2", items: body.items })
    }
    if (url.pathname === "/second-brain/vault/timeline") return json(timeline)
    if (url.pathname === "/second-brain/vault/log") return json(log)
    if (url.pathname === "/second-brain/vault/conflicts") return json(options.conflicts ?? [])
    return json([])
  })
  return writes
}

const open = async (page: Page, options?: Parameters<typeof mockVault>[1]) => {
  await openApp(page, { projectThreads: [project] })
  const writes = await mockVault(page, options)
  return writes
}

test.use({ viewport: { width: 1360, height: 860 } })

test("AC-4.1 the landing lists Projects and General pages, with no page tree", async ({ page }) => {
  await open(page)
  await page.goto("/projects")
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible()
  await expect(page.locator('[data-project-row="project_01ACME"]')).toContainText("Acme API")
  await expect(page.getByRole("region", { name: "General" }).getByRole("button", { name: /Ideas/ })).toBeVisible()
  await expect(page.getByRole("tree")).toHaveCount(0)
  await expect(page.getByRole("checkbox")).toHaveCount(0)
})

test("AC-4.2 a Project is one page: a section bar and no tabs; an older tab= link scrolls to its section", async ({
  page,
}) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  const bar = page.getByRole("navigation", { name: "Project sections" })
  for (const name of ["Tasks", "Pages", "Threads", "Log", "Settings"])
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible()
  await expect(bar.getByRole("button", { name: "Start work", exact: true })).toBeVisible()
  await expect(page.getByRole("tab")).toHaveCount(0)
  await page.goto(`/projects?project=${project.project.id}&tab=log`)
  await expect(page.getByRole("region", { name: "Log" })).toBeInViewport()
})

test("AC-4.3 the sections show the Project's tasks, timeline, pages and log", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  // Open shows what is not done; All adds the done task.
  await expect(page.locator("[data-task]")).toHaveCount(3)
  await page.getByRole("button", { name: "All", exact: true }).click()
  await expect(page.locator("[data-task]")).toHaveCount(4)
  await expect(page.locator('[data-task="launch"]')).toHaveAttribute("data-kind", "milestone")
  await expect(page.locator("[data-timeline-item]")).toHaveCount(4)
  const pagesSection = page.getByRole("region", { name: "Pages" })
  await expect(pagesSection.getByRole("link", { name: /Auth redesign/ })).toBeVisible()
  await expect(pagesSection.getByRole("link", { name: /Billing notes/ })).toBeVisible()
  const texts = await page.getByRole("region", { name: "Log" }).getByText(/Token rotation finished|Moved Billing webhooks/).allTextContents()
  expect(texts[0]).toContain("Token rotation finished")
})

test("AC-4.3 a task is added from the task line with a date, and its status changes from its pill", async ({ page }) => {
  const writes = await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  await page.getByRole("button", { name: "Due date", exact: true }).click()
  await page.locator("[data-component=date-picker]").getByRole("button", { name: "Tomorrow", exact: true }).click()
  await page.getByRole("textbox", { name: "Add a task", exact: true }).fill("Signed cookies")
  await page.keyboard.press("Enter")
  await expect.poll(() => writes.filter((write) => write.path === "timeline").length).toBe(1)
  const added = (writes[0].body as { items: { title: string; end?: string; status: string }[] }).items.at(-1)!
  expect(added).toMatchObject({ title: "Signed cookies", status: "todo" })
  expect(added.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await expect(page.locator("[data-task]").filter({ hasText: "Signed cookies" })).toBeVisible()

  await page.getByRole("button", { name: "Status of Billing webhooks", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Doing" }).click()
  await expect.poll(() => writes.filter((write) => write.path === "timeline").length).toBe(2)
  const changed = (writes[1].body as { items: { id: string; status: string }[] }).items.find((item) => item.id === "hooks")
  expect(changed?.status).toBe("doing")
  await expect(page.locator("main select, main input[type=date]")).toHaveCount(0)
})

test("AC-4.4 a page opens full width and Back returns to the Project", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  await page.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Billing notes/ }).click()
  await expect(page).toHaveURL(/page=/)
  await expect(page.getByRole("heading", { name: "Billing notes" }).first()).toBeVisible()
  await page.goBack()
  await expect(page.getByRole("region", { name: "Pages" })).toBeVisible()
})

test("AC-4.5 New page creates in the open Project and Save sends the loaded revision", async ({ page }) => {
  const writes = await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  await page.locator('[data-action="project-new-page"]').click()
  await expect.poll(() => writes.filter((write) => write.path !== "timeline").length).toBeGreaterThan(0)
  expect(writes[0].body).toMatchObject({ create: true, projectId: project.project.id })

  await page.goto(`/projects?page=${encodeURIComponent("Ideas.md")}`)
  await page.getByRole("article").getByRole("textbox").first().click()
  await page.keyboard.type(" more")
  await page.getByRole("button", { name: "Save" }).click()
  await expect.poll(() => writes.filter((write) => write.path === "Ideas.md").length).toBe(1)
  expect(writes.find((write) => write.path === "Ideas.md")!.body).toMatchObject({ expectedRevision: "r1" })
})

test("AC-4.5 a conflicting save shows a message instead of overwriting", async ({ page }) => {
  await open(page, { conflictOnSave: true })
  await page.goto(`/projects?page=${encodeURIComponent("Ideas.md")}`)
  await page.getByRole("article").getByRole("textbox").first().click()
  await page.keyboard.type(" edit")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("This page changed somewhere else")).toBeVisible()
})

test("AC-4.6 conflict copies are named in a banner", async ({ page }) => {
  await open(page, {
    conflicts: [{ path: "Acme API/Plan (conflicted copy 2026-11-02).md", original: "Acme API/Plan.md" }],
  })
  await page.goto("/projects")
  await expect(page.getByText("Plan (conflicted copy 2026-11-02).md")).toBeVisible()
})

// implementations/merge-notes-projects/implementation.md (Notes and Projects are one Projects page)
test("merge AC-5 /notes links open the same Project under /projects", async ({ page }) => {
  await open(page)
  await page.goto(`/notes?project=${project.project.id}&tab=board`)
  await expect(page).toHaveURL(new RegExp(`/projects\\?project=${project.project.id}&tab=board$`))
  await expect(page.getByRole("region", { name: "Tasks" })).toBeVisible()
})

test("merge AC-3 Settings holds the Project's card", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}&section=settings`)
  await expect(page.getByRole("button", { name: "Archive Project", exact: true })).toBeVisible()
})

test("merge AC-4 New Project opens the create form", async ({ page }) => {
  await open(page)
  await page.goto("/projects")
  await page.locator('[data-action="new-project"]').click()
  await expect(page).toHaveURL(/\/projects\?new=1$/)
  await expect(page.getByRole("heading", { name: "Create a Project" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeFocused()
})
