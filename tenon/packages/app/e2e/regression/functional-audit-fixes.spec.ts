import { expect, test, type Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockTenonServer } from "../utils/mock-server"
import type { ProjectRecord, VaultPage } from "../../src/features/second-brain/client"

type Writes = { path: string; body: Record<string, unknown> }[]

async function setup(page: Page, spanish = false) {
  await mockTenonServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  // Home's composer shows the harness picker once the server lists its harnesses.
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        data: [{ id: "opencode", driver: "opencode", name: "Default agent", status: "available", models: [] }],
      },
    }),
  )
  await page.addInitScript(
    ({ directory, spanish }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: {} }))
      localStorage.setItem(
        "tenon.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
      if (spanish) localStorage.setItem("tenon.global.dat:language", JSON.stringify({ locale: "es" }))
    },
    { directory: fixture.directory, spanish },
  )
  const date = new Date().toLocaleDateString("en-CA")
  const project: ProjectRecord = {
    id: "project_audit",
    folder: "projects/project_audit",
    name: "Audit Project",
    outcome: "An editable outcome",
    instructions: "",
    status: "active",
    progressPercent: 25,
    tags: [],
    createdAt: date,
    updatedAt: date,
  }
  // Vault pages: paths are relative to the workspace's vault folder; a Project's pages sit in its folder.
  const folder = "Audit Project"
  const vaultPage = (path: string, title: string, body: string): VaultPage => ({
    info: {
      id: `page_${title.replaceAll(" ", "")}`,
      path,
      title,
      projectId: project.id,
      properties: {},
      updatedAt: date,
    },
    body,
    revision: "1",
  })
  const pages = [
    vaultPage(`${folder}/Alpha.md`, "Alpha", "# First heading\n\nUnique-body-needle and [[Beta]]."),
    vaultPage(`${folder}/Beta.md`, "Beta Updated", "# Beta body"),
  ]
  // A file the page list has not seen yet (written by another machine), so creating it is refused.
  const unlisted = new Set(["Untitled.md"])
  const writes: Writes = []
  await page.route("**/second-brain/**", async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith("/second-brain/")) return route.fallback()
    const method = route.request().method()
    if (url.pathname === "/second-brain/projects") return route.fulfill({ json: [project] })
    // Home and the sidebar list Projects with their thread folder (the card folder here).
    if (url.pathname === "/second-brain/project-threads")
      return route.fulfill({
        json: [
          {
            project,
            threadDirectory: `${fixture.directory}/${project.folder}`,
            threadDirectoryKind: "project",
            workspace: null,
            rootSessionCount: 0,
            lastActivityAt: null,
          },
        ],
      })
    if (url.pathname === "/second-brain/project") {
      if (method === "PATCH") Object.assign(project, route.request().postDataJSON())
      return route.fulfill({ json: project })
    }
    if (url.pathname === "/second-brain/vault/migrate") return route.fulfill({ json: { moved: 2, backup: "b" } })
    if (url.pathname === "/second-brain/vault/pages") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase()
      return route.fulfill({
        json: pages
          .filter((page) => !search || `${page.info.title} ${page.body}`.toLowerCase().includes(search))
          .map((page) => page.info),
      })
    }
    if (url.pathname === "/second-brain/vault/page") {
      const path = url.searchParams.get("path") ?? ""
      if (method !== "PUT") {
        const page = pages.find((item) => item.info.path === path)
        return page ? route.fulfill({ json: page }) : route.fulfill({ status: 404, json: {} })
      }
      const body = route.request().postDataJSON()
      writes.push({ path, body })
      const full = body.projectId && !path.startsWith(`${folder}/`) ? `${folder}/${path}` : path
      const page = pages.find((item) => item.info.path === full)
      if (body.create) {
        if (page || unlisted.has(full)) return route.fulfill({ status: 409, json: { data: { message: "exists" } } })
        const created = vaultPage(full, body.title, body.body)
        pages.push(created)
        return route.fulfill({ json: created })
      }
      if (!page) return route.fulfill({ status: 404, json: {} })
      if (body.expectedRevision !== page.revision)
        return route.fulfill({ status: 409, json: { data: { message: "stale" } } })
      Object.assign(page, { body: body.body, revision: String(Number(page.revision) + 1) })
      page.info.title = body.title ?? page.info.title
      return route.fulfill({ json: page })
    }
    if (url.pathname === "/second-brain/vault/timeline")
      return route.fulfill({ json: { projectId: project.id, revision: "1", items: [], progress: 0 } })
    if (url.pathname === "/second-brain/vault/log" || url.pathname === "/second-brain/vault/conflicts")
      return route.fulfill({ json: [] })
    if (url.pathname === "/second-brain/calendar")
      return route.fulfill({
        json: {
          version: 2,
          revision: "1",
          events: [{ id: "event_audit", title: "Audit Event", date, source: "local", syncState: "local" }],
          tasks: [
            {
              id: "task_audit",
              title: "Audit Task",
              dueDate: date,
              projectId: project.id,
              source: "local",
              syncState: "local",
              createdAt: date,
              updatedAt: date,
            },
          ],
        },
      })
    return route.fulfill({ status: 404, json: {} })
  })
  return writes
}

test("notes preserve edits across navigation, search bodies, render headings and stable wiki links", async ({
  page,
}, testInfo) => {
  const writes = await setup(page)
  await page.goto("/projects")
  // The first visit moves the workspace's pre-vault notes into the vault and says how many.
  await expect(page.getByRole("status").filter({ hasText: "Moved 2 notes into the Tenon vault" })).toBeVisible()
  await page.getByRole("textbox", { name: "Search pages" }).fill("Unique-body-needle")
  const results = page.getByRole("list", { name: "Search results" })
  // A result names its Project after the title.
  await expect(results.getByRole("button", { name: /^Alpha/ })).toBeVisible()
  await expect(results.getByRole("button", { name: /^Beta Updated/ })).toHaveCount(0)
  await results.getByRole("button", { name: /^Alpha/ }).click()
  await expect(page).toHaveURL(/\/projects\?page=Audit%20Project%2FAlpha\.md$/)
  await expect(page.getByRole("heading", { name: "First heading" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("note-preview.png"), fullPage: true })
  await page.getByRole("link", { name: "Beta", exact: true }).click()
  await expect(page).toHaveURL(/\/projects\?page=Audit%20Project%2FBeta\.md$/)
  await expect(page.getByRole("heading", { name: "Beta body" })).toBeVisible()
  await page.getByRole("button", { name: "Write", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Markdown note editor" })
  await editor.fill("Edited, unsaved body")
  await page.getByRole("button", { name: "Calendar", exact: true }).click()
  await expect(page).toHaveURL(/\/projects\?page=/)
  await expect(editor).toHaveValue("Edited, unsaved body")
  await expect(page.getByRole("alert")).toContainText("Save or discard")
  await page.screenshot({ path: testInfo.outputPath("notes.png"), fullPage: true })
  await page.getByRole("button", { name: "Save", exact: true }).click()
  // Saving sends the revision the page was loaded at, clears the warning and keeps the text.
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(editor).toHaveValue("Edited, unsaved body")
  expect(writes).toEqual([
    {
      path: "Audit Project/Beta.md",
      body: expect.objectContaining({ body: "Edited, unsaved body", expectedRevision: "1" }),
    },
  ])
  // Saved, the page can be left again.
  await page.getByRole("button", { name: "Calendar", exact: true }).click()
  await expect(page).toHaveURL(/\/calendar$/)
})

test("a New page error shows on the Projects page, and New page in a Project opens there", async ({
  page,
}, testInfo) => {
  const writes = await setup(page)
  await page.goto("/projects")
  await page.getByRole("button", { name: "New page", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("A page with this name already exists")
  await page.screenshot({ path: testInfo.outputPath("new-page.png"), fullPage: true })

  await page.locator('[data-project-row="project_audit"]').click()
  await expect(page).toHaveURL(/\/projects\?project=project_audit$/)
  await page.locator('[data-action="project-new-page"]').click()
  await expect(page).toHaveURL(/\/projects\?page=Audit%20Project%2FUntitled\.md$/)
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Untitled")
  expect(writes.map((write) => [write.path, write.body.create, write.body.projectId])).toEqual([
    ["Untitled.md", true, undefined],
    ["Untitled.md", true, "project_audit"],
  ])
})

test("Home opens the selected event, task and project; Today resets the displayed date", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/")
  await page.getByRole("button", { name: /Audit Event/ }).click()
  // An event opened from Home shows its preview first; Edit opens the editor.
  await expect(page.getByRole("heading", { name: "Audit Event", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue("Audit Event")
  // Close the editor so its draft doesn't hold later navigation.
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Event title" })).toHaveCount(0)
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page.getByRole("button", { name: /Audit Task/ }).click()
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveValue("Audit Task")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  // Regression: clicking during Home's fade-in once changed the URL to /projects but left Home on screen.
  // Home's Active Projects card (the sidebar lists the same Project by name only).
  await page.getByRole("button", { name: "Audit Project 25%", exact: true }).click()
  await expect(page.getByText("An editable outcome", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Calendar", exact: true }).click()
  await page.getByRole("button", { name: "Month", exact: true }).click()
  await page.getByRole("button", { name: "Next month", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Calendar views" })
    .getByRole("button", { name: "Today", exact: true })
    .click()
  await expect(page.getByRole("button", { name: /Audit Event/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Previous day" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("calendar.png"), fullPage: true })
})

test("an archived Project restores from the Archived fold and its Pages open", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/projects?project=project_audit&section=settings")
  await page.getByRole("button", { name: "Archive Project", exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await page.getByRole("button", { name: /^Archived/ }).click()
  await page.locator('[data-project-row="project_audit"]').click()
  await expect(page).toHaveURL(/\/projects\?project=project_audit$/)
  await page.locator('[data-section-link="settings"]').click()
  await page.getByRole("button", { name: "Restore Project", exact: true }).click()
  await expect(page.getByRole("button", { name: "Pause Project", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("project-pages.png"), fullPage: true })
  await page.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Beta Updated/ }).click()
  await expect(page.getByRole("heading", { name: "Beta body" })).toBeVisible()
})

test("Spanish Brain navigation and harness names are localized", async ({ page }, testInfo) => {
  await setup(page, true)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Proyectos", exact: true })).toBeVisible()
  // The harness is chosen in the composer's model pill since the composer redesign.
  await page.getByRole("button", { name: "Claude Opus 4.6", exact: true }).click()
  await expect(page.getByText("Motor de agente", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("spanish-home.png"), fullPage: true })
})

test("settings switches have names and Escape cancels shortcut recording before closing settings", async ({
  page,
}, testInfo) => {
  await setup(page)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  const switches = dialog.getByRole("switch")
  expect(await switches.count()).toBeGreaterThan(0)
  for (const control of await switches.all()) await expect(control).toHaveAccessibleName(/.+/)
  await dialog.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  await dialog.locator("[data-keybind-id]").first().click()
  await expect(dialog.locator(".settings-v2-keybind-button--active")).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(".settings-v2-keybind-button--active")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true })
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("blank server submission keeps its form and explains the missing address", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Servers", exact: true }).click()
  await page.getByRole("button", { name: "Add server", exact: true }).click()
  const address = page.getByRole("textbox", { name: "Server address", exact: true })
  await expect(address).toBeVisible()
  await address.fill("")
  await page.getByRole("button", { name: "Add server", exact: true }).click()
  await expect(address).toBeVisible()
  await expect(page.getByText("Server address: Required", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("server-validation.png"), fullPage: true })
})
