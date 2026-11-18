import { expect, test } from "@playwright/test"
import { brain, openApp } from "../acceptance/open-app"

// implementations/harness-ux-batch-2, AC-1 and AC-3: Home's composer is the thread composer, Home stays usable while
// the harness list is still being checked, sending from Home opens the new thread, and picking a Project carries the
// text and harness to a new thread there.

test.use({ viewport: { width: 1360, height: 860 } })

const composer = (page: import("@playwright/test").Page) =>
  page.locator('main [data-component="prompt-input-v2"]').first()
const editor = (page: import("@playwright/test").Page) => composer(page).locator('[contenteditable="true"]').first()

test("Home shows the thread composer while the harness list is still being checked", async ({ page }) => {
  await openApp(page)
  const harness = Promise.withResolvers<void>()
  await page.route("**/api/harness?**", async (route) => {
    await harness.promise
    await route.fulfill({
      json: {
        location: { directory: brain, project: { id: "proj", directory: brain } },
        data: [{ id: "opencode", driver: "opencode", name: "OpenCode", status: "available", models: [] }],
      },
    })
  })
  try {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeAttached()
    await expect(composer(page)).toBeVisible()
    await expect(page.getByText("Checking harnesses…", { exact: true })).toHaveCount(0)
    await editor(page).click()
    await page.keyboard.type("A draft while harnesses load")
    await expect(editor(page)).toContainText("A draft while harnesses load")
    expect(page.url()).toMatch(/\/$/)
  } finally {
    harness.resolve()
  }
})

test("picking a Project from Home opens a new thread there with the text", async ({ page }) => {
  const project = {
    id: "proj_release",
    folder: "projects/release",
    name: "Release notes project",
    outcome: "",
    instructions: "",
    status: "active",
    progressPercent: 0,
    tags: [],
    createdAt: "2026-11-18",
    updatedAt: "2026-11-18",
  }
  await openApp(page, {
    projectThreads: [
      {
        project,
        threadDirectory: `${brain}/${project.folder}`,
        threadDirectoryKind: "project",
        workspace: null,
        rootSessionCount: 0,
        lastActivityAt: null,
      },
    ],
  })
  await page.goto("/")
  await expect(composer(page)).toBeVisible()
  await editor(page).click()
  await page.keyboard.type("Carry this over")
  await composer(page)
    .getByRole("button", { name: /General/ })
    .click()
  await page.getByRole("menuitemradio", { name: /Release notes project/ }).click()
  await expect(page).toHaveURL(/\/new-thread\?project=proj_release&draftId=/)
  await expect(composer(page)).toContainText("Carry this over")
})

test("sending from Home creates the thread and opens it", async ({ page }) => {
  const created: Array<{ sessionID: string; directory?: string }> = []
  const prompts: Array<{ sessionID: string; body: unknown }> = []
  await openApp(page, {
    onSessionCreate: (input) => created.push(input),
    onPrompt: (input) => prompts.push(input),
  })
  await page.goto("/")
  await expect(composer(page)).toBeVisible()
  await editor(page).click()
  await page.keyboard.type("Plan the release notes")
  await expect(page).toHaveURL(/\/$/)
  await page.keyboard.press("Enter")
  await expect.poll(() => created.length).toBe(1)
  await expect(page).toHaveURL(new RegExp(`/session/${created[0]!.sessionID}$`))
  await expect.poll(() => prompts.length).toBe(1)
  expect(JSON.stringify(prompts[0]!.body)).toContain("Plan the release notes")
})
