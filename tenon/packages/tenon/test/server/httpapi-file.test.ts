import { afterEach, describe, expect, test } from "bun:test"
import { Context, Effect } from "effect"
import { createHash } from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { pollWithTimeout } from "../lib/effect"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual([])
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])
    const files = await Effect.runPromise(
      pollWithTimeout(
        Effect.promise(async () => {
          const response = await request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" })
          const body = await response.json()
          return body.includes("hello.txt") ? { response, body } : undefined
        }),
        "file search index was not ready",
      ),
    )

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.response.status).toBe(200)
    expect(files.body).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})

function write(directory: string, body: { path: string; content: string; expectedHash: string }) {
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${FilePaths.write}`, {
      method: "PUT",
      headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context,
  )
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

// Symlinks on Windows need Developer Mode or an elevated shell; without the privilege that test skips.
const canSymlink = await (async () => {
  if (process.platform !== "win32") return true
  const probe = path.join(os.tmpdir(), `tenon-symlink-probe-${process.pid}`)
  await Bun.write(probe, "")
  const ok = await fs
    .symlink(probe, `${probe}-link`, "file")
    .then(() => true)
    .catch(() => false)
  await Promise.all([fs.rm(probe, { force: true }), fs.rm(`${probe}-link`, { force: true })])
  return ok
})()

describe("file write HttpApi", () => {
  test("keeps CRLF line endings and the outer whitespace", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "notes.md")
    await Bun.write(file, "\r\n# Old\r\nline\r\n\r\n")
    const response = await write(tmp.path, {
      path: "notes.md",
      content: "# New\r\nline\r\n",
      expectedHash: sha("# Old\r\nline"),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hash: sha("# New\r\nline") })
    expect(await Bun.file(file).text()).toBe("\r\n# New\r\nline\r\n\r\n")
  })

  test("keeps a UTF-8 byte-order mark, hashing the text as the content route returns it", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "notes.md")
    await Bun.write(file, new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("# Old\r\n")]))
    const read = await request(FilePaths.content, tmp.path, { path: "notes.md" })
    const shown = ((await read.json()) as { content: string }).content
    expect(shown).toBe("# Old")
    const response = await write(tmp.path, { path: "notes.md", content: "# New", expectedHash: sha(shown) })
    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("# New\r\n")
  })

  test("refuses missing files, folders, binary files and absolute paths outside, writing nothing", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "docs"))
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
    await Bun.write(path.join(tmp.path, "image.png"), bytes)
    await using outside = await tmpdir()
    await Bun.write(path.join(outside.path, "secret.md"), "secret")
    const cases = [
      { path: "missing.md", status: 404 },
      { path: "docs", status: 400 },
      { path: "image.png", status: 400 },
      { path: path.join(outside.path, "secret.md"), status: 400 },
    ]
    for (const item of cases) {
      const response = await write(tmp.path, { path: item.path, content: "x", expectedHash: sha("") })
      expect({ path: item.path, status: response.status }).toEqual(item)
    }
    expect(await Bun.file(path.join(tmp.path, "missing.md")).exists()).toBe(false)
    expect(new Uint8Array(await Bun.file(path.join(tmp.path, "image.png")).arrayBuffer())).toEqual(bytes)
    expect(await Bun.file(path.join(outside.path, "secret.md")).text()).toBe("secret")
  })

  test.skipIf(!canSymlink)("doesn't follow a file symlink out of the folder", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const target = path.join(outside.path, "secret.md")
    await Bun.write(target, "secret")
    await fs.symlink(target, path.join(tmp.path, "link.md"), "file")
    const response = await write(tmp.path, { path: "link.md", content: "pwned", expectedHash: sha("secret") })
    expect(response.status).toBe(400)
    expect(await Bun.file(target).text()).toBe("secret")
  })

  // A directory junction needs no privilege on Windows, so this one runs on both platforms.
  test("doesn't follow a linked folder out of the folder", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const target = path.join(outside.path, "secret.md")
    await Bun.write(target, "secret")
    await fs.symlink(outside.path, path.join(tmp.path, "out"), process.platform === "win32" ? "junction" : "dir")
    const response = await write(tmp.path, { path: "out/secret.md", content: "pwned", expectedHash: sha("secret") })
    expect(response.status).toBe(400)
    expect(await Bun.file(target).text()).toBe("secret")
  })
})
