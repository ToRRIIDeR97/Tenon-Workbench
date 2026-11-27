import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@tenon/core/util/encode"
import { brain, openApp } from "./open-app"
import { fixture } from "../smoke/session-timeline.fixture"

const PHONE = { width: 390, height: 844 }
const thread = {
  id: "ses_phone",
  slug: "ses_phone",
  projectID: fixture.project.id,
  directory: brain,
  title: "Plan the week",
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const threadPath = `/${base64Encode(brain)}/session/ses_phone`

async function open(page: Page, extra: Parameters<typeof openApp>[1] = {}) {
  await openApp(page, {
    sessions: [thread],
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_phone",
            role: "user",
            time: { created: 1_700_000_000_000 },
            agent: "build",
            model: { providerID: "opencode", modelID: "test" },
          },
          parts: [
            { id: "prt_1", sessionID: "ses_phone", messageID: "msg_1", type: "text", text: "What is on this week?" },
          ],
        },
      ],
    }),
    ...extra,
  })
}

function outside(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth
    const scrolls = (element: Element | null): boolean => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (["auto", "scroll"].includes(style.overflowX) && node.scrollWidth > node.clientWidth) return true
      }
      return false
    }
    return Array.from(document.querySelectorAll("main *, [data-component='second-brain-sidebar'] *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        if (getComputedStyle(element).visibility === "hidden") return false
        return (rect.right > width + 1 || rect.left < -1) && !scrolls(element.parentElement)
      })
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} ${element.getAttribute("data-component") ?? ""} ${(element.textContent ?? "").slice(0, 40)}`,
      )
  })
}

const nav = (page: Page) => page.locator('[data-component="second-brain-sidebar"] nav')

test.describe("phone width", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

  test("AC-P7-1 Home, Calendar, the new thread and a thread fit the width", async ({ page }) => {
    await open(page)
    for (const path of ["/", "/calendar", "/new-thread", threadPath]) {
      await page.goto(path)
      await expect(page.locator("main")).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width)
      expect({ path, outside: await outside(page) }).toEqual({ path, outside: [] })
    }
  })

  test("AC-P7-2 navigation is a bottom bar with large targets", async ({ page }) => {
    await open(page)
    await page.goto("/")
    const bar = nav(page)
    await expect(bar).toBeVisible()
    const box = (await bar.boundingBox())!
    expect(box.y + box.height).toBeGreaterThanOrEqual(PHONE.height - 1)
    expect(box.height).toBeGreaterThanOrEqual(56)
    expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 1)
    for (const item of ["overview", "projects", "calendar", "command", "threads", "settings"]) {
      const button = page.locator(`[data-sidebar-item="${item}"]`)
      await expect(button).toBeVisible()
      const target = (await button.boundingBox())!
      expect(target.width).toBeGreaterThanOrEqual(44)
      expect(target.height).toBeGreaterThanOrEqual(44)
      expect(target.y).toBeGreaterThanOrEqual(box.y - 1)
    }
    const main = (await page.locator("main").boundingBox())!
    expect(main.x).toBeLessThan(16)
    expect(main.y + main.height).toBeLessThanOrEqual(box.y + 1)
    await page.locator('[data-sidebar-item="calendar"]').click()
    await expect(page).toHaveURL(/\/calendar$/)
  })

  test("AC-P7-3 Threads opens the thread list over the page and a thread closes it", async ({ page }) => {
    await open(page)
    await page.goto("/")
    const list = page.locator('[data-component="second-brain-sidebar"] aside')
    await expect(list).toBeHidden()
    await page.locator('[data-sidebar-item="threads"]').click()
    await expect(list).toBeVisible()
    const box = (await list.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 16)
    await list.getByRole("button", { name: "General", exact: true }).click()
    const row = page.locator('[data-sidebar-thread="ses_phone"]').first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(/\/session\/ses_phone/)
    await expect(list).toBeHidden()
  })

  test("AC-P7-4 the composer fits above the bar, with a large send button, also with the keyboard up", async ({
    page,
  }) => {
    await open(page)
    await page.goto(threadPath)
    const composer = page.locator('[data-component="prompt-input-v2"]').first()
    await expect(composer).toBeVisible()
    const send = page.locator('[data-action="prompt-submit"]').first()
    const sendBox = (await send.boundingBox())!
    expect(sendBox.width).toBeGreaterThanOrEqual(40)
    expect(sendBox.height).toBeGreaterThanOrEqual(40)
    const bar = (await nav(page).boundingBox())!
    const box = (await composer.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1)
    await page.locator('[data-component="prompt-input"]').first().click()
    await page.setViewportSize({ width: PHONE.width, height: 420 })
    await expect
      .poll(async () => {
        const after = (await composer.boundingBox())!
        return after.y >= 0 && after.y + after.height <= 420
      })
      .toBe(true)
    await expect(page.locator('[data-component="prompt-input"]').first()).toBeFocused()
  })
})

test.describe("desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("AC-P7-6 the rail stays a left column and there is no Threads button", async ({ page }) => {
    await open(page)
    await page.goto("/")
    const box = (await nav(page).boundingBox())!
    expect(box.x).toBeLessThan(80)
    expect(box.height).toBeGreaterThan(300)
    expect(box.width).toBeLessThanOrEqual(64)
    await expect(page.locator('[data-sidebar-item="threads"]')).toBeHidden()
  })
})
