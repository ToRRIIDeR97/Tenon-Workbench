import type { Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockTenonServer, type MockServerConfig } from "../utils/mock-server"

// Shared setup for the notes-command-centre acceptance tests (implementations/notes-command-centre).
export const brain = fixture.directory

export async function openApp(page: Page, input: Partial<MockServerConfig> = {}) {
  await mockTenonServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
    projectThreads: [],
    ...input,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "tenon.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: {} }),
    )
  }, brain)
}

export const sidebar = (page: Page) => page.locator('[data-component="second-brain-sidebar"]')
