import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@tenon/core/util/encode"
import { mockTenonServer } from "../utils/mock-server"

const PHONE = { width: 390, height: 844 }
const directory = "C:/OpenCode/PhoneDocks"
const sessionID = "ses_phone_docks"

test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

async function open(page: Page, requests: { permissions?: unknown[]; questions?: unknown[] }) {
  await mockTenonServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: "proj_phone_docks",
      worktree: directory,
      vcs: "git",
      name: "phone-docks",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "phone-docks",
        projectID: "proj_phone_docks",
        directory,
        title: "Phone docks",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    permissions: requests.permissions,
    questions: requests.questions,
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
}

async function fitsWithLargeTargets(page: Page, dock: ReturnType<Page["locator"]>) {
  await expect(dock).toBeVisible()
  const box = (await dock.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
  const bar = (await page.locator('[data-component="second-brain-sidebar"] nav').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1)
  const buttons = dock.locator("button:visible")
  const count = await buttons.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const target = (await buttons.nth(index).boundingBox())!
    expect(target.x + target.width).toBeLessThanOrEqual(PHONE.width)
    expect(target.height).toBeGreaterThanOrEqual(36)
  }
}

test("AC-P7-5 a permission request fits the phone and can be answered", async ({ page }) => {
  await open(page, {
    permissions: [
      {
        id: "permission-phone",
        sessionID,
        permission: "bash",
        patterns: ["git status", "npm run build -- --filter=@tenon/app --verbose"],
        metadata: {},
        always: [],
      },
    ],
  })
  const dock = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
  await fitsWithLargeTargets(page, dock)
  const reply = page.waitForRequest((request) => request.method() === "POST")
  await dock.getByRole("button", { name: "Allow once" }).tap()
  expect((await reply).postDataJSON()).toEqual({ reply: "once" })
})

test("AC-P7-5 a question fits the phone and can be answered", async ({ page }) => {
  await open(page, {
    questions: [
      {
        id: "question-phone",
        sessionID,
        questions: [
          {
            header: "Implementation",
            question: "Which implementation should be used for the phone layout?",
            options: [
              { label: "Minimal", description: "Use the smallest correct change" },
              { label: "Extended", description: "Include additional behaviour for every page" },
            ],
          },
        ],
      },
    ],
  })
  const dock = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await fitsWithLargeTargets(page, dock)
  await dock.getByRole("radio", { name: /Minimal/ }).tap()
  const reply = page.waitForRequest((request) => request.method() === "POST")
  await dock.getByRole("button", { name: "Submit" }).tap()
  expect((await reply).postDataJSON()).toEqual({ answers: [["Minimal"]] })
})
