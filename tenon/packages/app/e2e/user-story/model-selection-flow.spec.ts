import { expect, test } from "@playwright/test"
import { mockTenonServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { openFolderFromWorkspaceMenu } from "../utils/sidebar"

const directory = "C:/OpenCode/NewProject"

test("opens a project from the sidebar, connects OpenCode Go, and selects its model in a new thread", async ({
  page,
}) => {
  let connectedGo = false
  let pendingGo = false
  const connections: Array<{ integrationID: string; body: unknown }> = []

  await mockTenonServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode-go",
          name: "OpenCode Go",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: connectedGo ? ["opencode", "opencode-go"] : ["opencode"],
      default: { providerID: "opencode", modelID: "free-model" },
    }),
    integrationMethods: { "opencode-go": [{ type: "api", label: "API key" }] },
    onConnectKey: (input) => {
      connections.push(input)
      if (input.integrationID === "opencode-go") pendingGo = true
    },
    onInstanceDispose: () => {
      if (pendingGo) connectedGo = true
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: {} }))
    localStorage.setItem("tenon.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  await page.goto("/")
  await expectAppVisible(page.getByRole("button", { name: "Switch workspace" }))
  await openFolderFromWorkspaceMenu(page)
  await page.locator("[data-directory-path]").click()

  const brain = page.locator('[data-sidebar-group="__brain__"]')
  await expect(brain).toBeVisible()
  await brain.getByRole("button", { name: "General", exact: true }).click()
  await brain.getByRole("button", { name: "New thread", exact: true }).click()
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)

  const modelControl = composer.locator('[data-action="prompt-model-pill"]')
  const chooseModel = async () => {
    await modelControl.click()
    await page.locator('[data-component="prompt-model-pill-panel"] [data-step="model"]').click()
    await page.getByRole("menuitemradio", { name: "Choose from your providers", exact: true }).click()
  }
  const dialog = page.locator('[data-component="dialog-v2"]')
  await chooseModel()
  await expect(dialog.locator('[data-key="opencode:free-model"]')).toHaveAttribute("data-selected", "true")
  await expect(dialog.locator('[data-key="opencode-go:go-model-1"]')).toHaveCount(0)

  await dialog.getByRole("button", { name: "Connect provider", exact: true }).click()
  await page.locator('[data-provider-id="opencode-go"]').click()
  await page.locator('[data-input="provider-api-key"]').fill("mock-go-api-key")
  await page.locator('[data-action="provider-connect-submit"]').click()
  await expect(dialog).toHaveCount(0)
  expect(connections).toEqual([{ integrationID: "opencode-go", body: { type: "api", key: "mock-go-api-key" } }])

  await chooseModel()
  const goModel = dialog.locator('[data-key="opencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
})
