import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import { createRequire } from "module"
import path from "path"
import { HttpApiApp } from "../../../../tenon/packages/tenon/src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../../../tenon/packages/tenon/src/server/routes/instance/httpapi/groups/file"
import { resetDatabase } from "../../../../tenon/packages/tenon/test/fixture/db"
import { disposeAllInstances, tmpdir } from "../../../../tenon/packages/tenon/test/fixture/fixture"

const effect = createRequire(path.resolve(import.meta.dir, "../../../../tenon/packages/tenon/package.json"))("effect")
const context = effect.Context.empty()
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

function put(directory: string, body: unknown) {
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${FilePaths.write}`, {
      method: "PUT",
      headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("AC-23 file write", () => {
  test("writes when the hash matches and keeps the file's outer whitespace", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "notes.md")
    await Bun.write(file, "# Old\n")
    const response = await put(tmp.path, { path: "notes.md", content: "# New", expectedHash: sha("# Old") })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ hash: sha("# New") })
    expect(await Bun.file(file).text()).toBe("# New\n")
  })

  test("409 with the current hash when the file changed since it was read", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "notes.md")
    await Bun.write(file, "# Changed\n")
    const response = await put(tmp.path, { path: "notes.md", content: "# New", expectedHash: sha("# Old") })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ currentHash: sha("# Changed") })
    expect(await Bun.file(file).text()).toBe("# Changed\n")
  })

  test("refuses paths outside the folder", async () => {
    await using tmp = await tmpdir({ git: true })
    const response = await put(tmp.path, { path: "../escape.md", content: "x", expectedHash: sha("") })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await Bun.file(path.join(tmp.path, "..", "escape.md")).exists()).toBe(false)
  })
})
