import { base64Encode } from "@tenon/core/util/encode"
import { expect, test } from "@playwright/test"
import { mockTenonServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewOpenFile"
const projectID = "proj_review_open_file"
const sessionID = "ses_review_open_file"
const title = "Review open file"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("opens and searches project files inline", async ({ page }) => {
  const searches: { query: string; dirs?: string; limit?: number }[] = []
  await mockTenonServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "open-file-project",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    // Reported usage is what puts the context ring on the composer.
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_review_open_file",
            sessionID,
            role: "assistant",
            time: { created: 1700000001000 },
            parentID: "msg_review_open_file_user",
            modelID: "test",
            providerID: "opencode",
            mode: "build",
            agent: "build",
            path: { cwd: directory, root: directory },
            cost: 0.01,
            tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [],
        },
      ],
    }),
    vcsDiff: [fileDiff("src/changed.ts")],
    fileList: (path) => {
      if (path) return []
      return [
        fileNode("README.md"),
        { name: "src", path: "src", absolute: `${directory}/src`, type: "directory", ignored: false },
      ]
    },
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    findFiles: (input) => {
      searches.push(input)
      return input.query === "nested" ? ["src/nested.ts"] : []
    },
  })
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: {} }))
      localStorage.setItem(
        "tenon.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "tenon.global.dat:layout",
        JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
      )
      localStorage.setItem(
        "tenon.global.dat:review-panel-v2",
        JSON.stringify({ sidebarOpened: false, sidebarWidth: 240, expandMode: "collapse" }),
      )
    },
    { directory },
  )

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
  const sidebarToggle = panel.getByRole("button", { name: "Toggle file tree" })
  const contextRing = page.locator('[data-action="context-ring"]')
  // The composer's context ring stays while the panel is hidden; its menu reopens the panel on Details.
  await panel.getByRole("button", { name: "Hide review" }).click()
  await contextRing.click()
  await page.getByRole("button", { name: "View context usage" }).click()
  await expect(panel.getByRole("tab", { name: "Details" })).toHaveAttribute("data-selected", "")
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeDisabled()
  await expect(sidebar).toBeVisible()
  await panel.getByRole("tab", { name: "Details" }).click()
  await expect(panel.getByRole("tab", { name: "Details" })).toHaveAttribute("data-selected", "")
  await expect(sidebar).toBeHidden()
  await panel.getByRole("button", { name: "Open file" }).click()
  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await expect(filter).toBeFocused()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("open-file-project", { exact: true })).toBeVisible()

  await panel.getByRole("button", { name: "README.md" }).click()
  await expect(panel.getByRole("tab", { name: "README.md" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
  await expect(sidebar).toHaveCount(0)

  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "README.md" })).toHaveCount(0)
  await expect(sidebar).toBeVisible()
  await filter.fill("nested")
  const result = panel.getByRole("option", { name: /nested\.ts/ })
  await expect(result).toBeVisible()
  const resultID = await result.getAttribute("id")
  expect(resultID).toBeTruthy()
  await expect(filter).toHaveAttribute("aria-activedescendant", resultID!)
  await filter.press("Enter")
  await expect(panel.getByRole("tab", { name: "nested.ts" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:src/nested.ts", { exact: true })).toBeVisible()
  expect(searches).toContainEqual({ query: "nested", dirs: "false", limit: 200 })

  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "nested.ts" })).toHaveCount(1)
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(sidebarToggle).toBeDisabled()
  await panel.locator("#session-side-panel-review-tab").click()
  await expect(sidebarToggle).toBeEnabled()
  await panel.getByRole("tab", { name: "Open file" }).click()
  await page.keyboard.press("Control+w")
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveCount(0)
  await expect(panel.getByRole("tab", { name: "nested.ts" })).toHaveAttribute("data-selected", "")
})

function fileNode(path: string) {
  return {
    name: path,
    path,
    absolute: `${directory}/${path}`,
    type: "file",
    ignored: false,
  }
}

function fileDiff(file: string) {
  return {
    file,
    before: "before\n",
    after: "after\n",
    additions: 1,
    deletions: 1,
    status: "modified",
  }
}
