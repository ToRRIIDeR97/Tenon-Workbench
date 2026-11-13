import { afterAll, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Mocks are process-wide in bun, so this one also serves later files that import Electron's default export.
// Mocks are process-wide in bun: keep the same exports as server.test.ts's Electron mock, whichever runs first.
mock.module("electron", () => ({
  default: {},
  net: {},
  protocol: {},
  app: { getPath: () => "", isPackaged: false, on: () => {}, off: () => {} },
  crashReporter: {},
  shell: {},
  utilityProcess: {},
}))
const { fileViewerURL, isInside, resolveInside } = await import("./file-viewer")

describe("resolveInside", () => {
  const root = process.platform === "win32" ? String.raw`C:\work\repo` : "/work/repo"

  test("resolves a file inside the folder", () => {
    expect(resolveInside(root, "docs/spec.pdf")?.replaceAll("\\", "/")).toMatch(/\/work\/repo\/docs\/spec\.pdf$/)
  })

  test("refuses paths that leave the folder, the folder itself, and relative folders", () => {
    expect(resolveInside(root, "../secret.txt")).toBeUndefined()
    expect(resolveInside(root, "docs/../../secret.txt")).toBeUndefined()
    expect(resolveInside(root, "")).toBeUndefined()
    expect(resolveInside("relative/repo", "a.txt")).toBeUndefined()
  })
})

describe("isInside", () => {
  test("folds case on Windows and macOS only", () => {
    expect(isInside("C:\\Work\\Repo", "c:\\work\\repo\\a.pdf", "win32")).toBe(true)
    expect(isInside("C:\\work\\repo", "C:\\work\\repo2\\a.pdf", "win32")).toBe(false)
    expect(isInside("C:\\work\\repo", "D:\\work\\repo\\a.pdf", "win32")).toBe(false)
    expect(isInside("/Users/me/Repo", "/users/me/repo/a.pdf", "darwin")).toBe(true)
    expect(isInside("/home/me/Repo", "/home/me/repo/a.pdf", "linux")).toBe(false)
    expect(isInside("/home/me/repo", "/home/me/repo", "linux")).toBe(false)
  })

  test("refuses UNC folders", () => {
    expect(resolveInside("\\\\host\\share", "a.pdf")).toBeUndefined()
    expect(resolveInside("//host/share", "a.pdf")).toBeUndefined()
  })
})

// Creating symlinks on Windows needs Developer Mode or elevation, so the link case runs on POSIX.
describe.skipIf(process.platform === "win32")("fileViewerURL", () => {
  const base = mkdtemp(join(tmpdir(), "tenon-file-viewer-"))
  afterAll(async () => rm(await base, { recursive: true, force: true }))

  test("serves a file in the folder but not one a symlink points outside it", async () => {
    const root = await base
    const repo = join(root, "repo")
    await mkdir(repo)
    await writeFile(join(repo, "spec.pdf"), "pdf")
    await writeFile(join(root, "id_rsa"), "secret")
    await symlink(join(root, "id_rsa"), join(repo, "key.pdf"))
    await symlink(root, join(repo, "up"))
    expect(await fileViewerURL(repo, "spec.pdf")).toMatch(/^tenon-file:\/\/local\/[\w-]+\/spec\.pdf$/)
    expect(await fileViewerURL(repo, "key.pdf")).toBeUndefined()
    expect(await fileViewerURL(repo, "up/id_rsa")).toBeUndefined()
    expect(await fileViewerURL(repo, "missing.pdf")).toBeUndefined()
  })

  test("serves a symlink only when its target has the same extension", async () => {
    const repo = join(await base, "links")
    await mkdir(join(repo, "docs"), { recursive: true })
    await writeFile(join(repo, "docs", "x.html"), "<script>1</script>")
    await writeFile(join(repo, "docs", "real.PDF"), "pdf")
    await symlink(join(repo, "docs", "x.html"), join(repo, "report.pdf"))
    await symlink(join(repo, "docs", "real.PDF"), join(repo, "copy.pdf"))
    expect(await fileViewerURL(repo, "report.pdf")).toBeUndefined()
    expect(await fileViewerURL(repo, "copy.pdf")).toMatch(/^tenon-file:\/\/local\/[\w-]+\/real\.PDF$/)
  })
})
