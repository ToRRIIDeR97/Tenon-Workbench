import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { extractZip } from "../../src/util/archive"

describe.skipIf(process.platform !== "win32")("extractZip on Windows", () => {
  test("extracts into folders whose names carry quotes, brackets and $", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tenon-archive-"))
    try {
      const source = path.join(root, "it's [v1] $HOME")
      mkdirSync(source)
      writeFileSync(path.join(source, "hello.txt"), "hi")
      const zip = path.join(source, "pack.zip")
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Compress-Archive -LiteralPath $env:SRC -DestinationPath $env:ZIP -Force",
        ],
        { env: { ...process.env, SRC: path.join(source, "hello.txt"), ZIP: zip } },
      )
      const dest = path.join(root, "out' + '-joined")
      await extractZip(zip, dest)
      expect(readFileSync(path.join(dest, "hello.txt"), "utf8")).toBe("hi")
      expect(existsSync(source)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
