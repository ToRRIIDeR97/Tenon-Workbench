import { expect, test, type Page } from "@playwright/test"
import { openApp } from "./open-app"

// P4 · Notes F (implementations/notes-command-centre/implementation.md, AC-4.1 … AC-4.6)

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

test("AC-4.1 the page tree groups Project pages and workspace pages, with no Project checkboxes", async ({ page }) => {
  await open(page)
  await page.goto("/projects")
  const tree = page.getByRole("tree")
  await expect(tree.getByText("Projects", { exact: true })).toBeVisible()
  await expect(tree.getByText("General", { exact: true })).toBeVisible()
  await expect(tree.getByText("Acme API", { exact: true })).toBeVisible()
  await expect(tree.getByText("Ideas", { exact: true })).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
})

test("AC-4.2 a Project opens on Timeline and tab= selects another view", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  for (const name of ["Timeline", "Board", "Table", "Docs", "Log", "Details"])
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Timeline", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.goto(`/projects?project=${project.project.id}&tab=board`)
  await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("AC-4.3 each view shows the Project's items", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  await expect(page.locator("[data-timeline-item]")).toHaveCount(4)
  await expect(page.locator('[data-timeline-item="launch"]')).toHaveAttribute("data-kind", "milestone")

  await page.getByRole("tab", { name: "Board", exact: true }).click()
  await expect(page.getByRole("group", { name: "To do" })).toContainText("Billing webhooks")
  await expect(page.getByRole("group", { name: "Doing" })).toContainText("Auth redesign")
  await expect(page.getByRole("group", { name: "Done" })).toContainText("Rate limiting")

  await page.getByRole("tab", { name: "Table", exact: true }).click()
  const table = page.getByRole("table")
  await expect(table.getByRole("row").filter({ hasText: "Billing webhooks" })).toContainText("Nov 10")

  await page.getByRole("tab", { name: "Docs", exact: true }).click()
  await expect(page.getByRole("link", { name: "Auth redesign" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Billing notes" })).toBeVisible()

  await page.getByRole("tab", { name: "Log", exact: true }).click()
  const texts = await page.getByText(/Token rotation finished|Moved Billing webhooks/).allTextContents()
  expect(texts[0]).toContain("Token rotation finished")
})

test("AC-4.4 a page opens full width and Back returns to the tab", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}&tab=docs`)
  await page.getByRole("link", { name: "Billing notes" }).click()
  await expect(page).toHaveURL(/page=/)
  await expect(page.getByRole("heading", { name: "Billing notes" }).first()).toBeVisible()
  await page.goBack()
  await expect(page.getByRole("tab", { name: "Docs", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("AC-4.5 New page creates in the open Project and Save sends the loaded revision", async ({ page }) => {
  const writes = await open(page)
  await page.goto(`/projects?project=${project.project.id}`)
  await page.getByRole("button", { name: "New page" }).click()
  await expect.poll(() => writes.length).toBeGreaterThan(0)
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
test("merge AC-5 /notes links open the same view under /projects", async ({ page }) => {
  await open(page)
  await page.goto(`/notes?project=${project.project.id}&tab=board`)
  await expect(page).toHaveURL(new RegExp(`/projects\\?project=${project.project.id}&tab=board$`))
  await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("merge AC-3 the Details tab holds the Project's card", async ({ page }) => {
  await open(page)
  await page.goto(`/projects?project=${project.project.id}&tab=details`)
  await expect(page.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: "Start work", exact: true })).toBeVisible()
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
