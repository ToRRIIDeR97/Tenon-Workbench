import { expect, test, type Page } from "@playwright/test"
import { mockTenonServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import { expandTurnSteps, turnStep } from "../performance/timeline-stability/fixture"

const directory = "C:/OpenCode/TimelineStateRegression"
const projectID = "proj_timeline_state_regression"
const sessionID = "ses_timeline_state_regression"
const userMessageID = "msg_user_regression"
const assistantMessageID = "msg_assistant_regression"
const editPartID = "prt_0001_edit"
const textPartID = "prt_9999_text"
const title = "Timeline collapse state regression"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

declare global {
  interface Window {
    __timelineDiffProbe: {
      reset: () => void
      shadowRoots: () => number
    }
  }
}

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_text",
      sessionID,
      messageID: userMessageID,
      type: "text",
      text: "Please edit the file.",
    },
  ],
}

const editPart = {
  id: editPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "tool",
  callID: "call_edit_regression",
  tool: "edit",
  state: {
    status: "completed",
    input: { filePath: "src/regression.ts" },
    output: "Edited src/regression.ts",
    title: "src/regression.ts",
    metadata: {
      filediff: {
        file: "src/regression.ts",
        additions: 1,
        deletions: 1,
        before: "export const value = 'before'\n",
        after: "export const value = 'after'\n",
      },
      diff: "diff --git a/src/regression.ts b/src/regression.ts\n-export const value = 'before'\n+export const value = 'after'\n",
    },
    time: { start: 1700000001000, end: 1700000002000 },
  },
}

const streamedTextPart = {
  id: textPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "text",
  text: "Streaming added a later assistant text part.",
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [editPart],
}

test.describe("regression: session timeline local row state", () => {
  test("keeps a manually collapsed tool collapsed when later assistant content streams", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expandTurnSteps(page)

    const step = turnStep(page, editPartID)
    await expectAppVisible(step.item)
    await expect(step.row).toHaveAttribute("aria-expanded", "true")

    await step.item.evaluate((element) => {
      ;(element as HTMLElement).dataset.regressionMarker = "before-stream"
    })
    await step.row.click()
    await expect(step.row).toHaveAttribute("aria-expanded", "false")

    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part: streamedTextPart },
      },
    })

    await expect(page.locator(`[data-timeline-part-id="${textPartID}"]`).first()).toBeVisible({ timeout: 10_000 })

    expect(await readToolState(page)).toEqual({
      expanded: false,
      marker: "before-stream",
      row: "TurnSteps",
      streamedTextVisible: true,
    })
  })

  test("does not remount an edit diff when sibling parts or diff counts update", async ({ page }) => {
    const events: EventPayload[] = []
    await installDiffProbe(page)
    await mockServer(page, events)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expandTurnSteps(page)

    const wrapper = turnStep(page, editPartID).item
    await expectAppVisible(wrapper)
    const file = wrapper.locator('[data-component="file"][data-mode="diff"]')
    await expectAppVisible(file)
    await markDiffProbe(page)

    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part: streamedTextPart },
      },
    })

    await expect(page.locator(`[data-timeline-part-id="${textPartID}"]`).first()).toBeVisible({ timeout: 10_000 })
    const siblingProbe = await readDiffProbe(page)
    expect(siblingProbe).toEqual({
      fileMarker: "before",
      frameMarker: "before",
      rowKey: `turn-steps:${userMessageID}:0`,
      rowMarker: "before",
      shadowRoots: 0,
      toolMarker: "before",
    })

    await markDiffProbe(page)
    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part: editPartWithAdditions(2) },
      },
    })

    await expect(
      turnStep(page, editPartID).row.locator('[data-slot="diff-changes-additions"]').filter({ hasText: "+2" }),
    ).toBeVisible({ timeout: 10_000 })
    expect(await readDiffProbe(page)).toEqual({
      fileMarker: "before",
      frameMarker: "before",
      rowKey: `turn-steps:${userMessageID}:0`,
      rowMarker: "before",
      shadowRoots: 0,
      toolMarker: "before",
    })
  })
})

async function configurePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
        },
      }),
    )
  })
}

async function readToolState(page: Page) {
  return turnStep(page, editPartID).item.evaluate(
    (element, textPartID) => ({
      expanded:
        element.querySelector(':scope > [data-slot="turn-steps-row"]')?.getAttribute("aria-expanded") === "true",
      marker: (element as HTMLElement).dataset.regressionMarker,
      row: element.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"),
      streamedTextVisible: !!document.querySelector(`[data-timeline-part-id="${textPartID}"]`),
    }),
    textPartID,
  )
}

async function installDiffProbe(page: Page) {
  await page.addInitScript(() => {
    let shadowRootCount = 0
    const attachShadow = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      shadowRootCount += 1
      return attachShadow.call(this, init)
    }
    window.__timelineDiffProbe = {
      reset: () => {
        shadowRootCount = 0
      },
      shadowRoots: () => shadowRootCount,
    }
  })
}

async function markDiffProbe(page: Page) {
  await turnStep(page, editPartID).item.evaluate((element) => {
    const tool = element as HTMLElement
    const file = tool.querySelector<HTMLElement>('[data-component="file"][data-mode="diff"]')
    const row = tool.closest<HTMLElement>("[data-timeline-key]")
    const frame = tool.closest<HTMLElement>("[data-timeline-row]")
    if (!file) throw new Error("missing edit diff file")
    if (!row) throw new Error("missing virtual timeline row")
    if (!frame) throw new Error("missing timeline row frame")

    tool.dataset.timelineProbe = "before"
    file.dataset.timelineProbe = "before"
    row.dataset.timelineProbe = "before"
    frame.dataset.timelineProbe = "before"
    window.__timelineDiffProbe.reset()
  })
}

async function readDiffProbe(page: Page) {
  return turnStep(page, editPartID).item.evaluate((element) => {
    const tool = element as HTMLElement
    const file = tool.querySelector<HTMLElement>('[data-component="file"][data-mode="diff"]')
    const row = tool.closest<HTMLElement>("[data-timeline-key]")
    const frame = tool.closest<HTMLElement>("[data-timeline-row]")
    return {
      fileMarker: file?.dataset.timelineProbe,
      shadowRoots: window.__timelineDiffProbe.shadowRoots(),
      toolMarker: tool.dataset.timelineProbe,
      rowMarker: row?.dataset.timelineProbe,
      rowKey: row?.dataset.timelineKey,
      frameMarker: frame?.dataset.timelineProbe,
    }
  })
}

function editPartWithAdditions(additions: number) {
  return {
    ...editPart,
    state: {
      ...editPart.state,
      metadata: {
        ...editPart.state.metadata,
        filediff: {
          ...editPart.state.metadata.filediff,
          additions,
        },
      },
    },
  }
}

async function mockServer(page: Page, events: EventPayload[], messages = [userMessage, assistantMessage]) {
  await mockTenonServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: messages }),
    events: () => events.splice(0, 1),
    eventRetry: 16,
  })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-state-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "timeline-state-regression",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
