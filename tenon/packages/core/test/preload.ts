import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll } from "bun:test"

const data = await fs.mkdtemp(path.join(os.tmpdir(), "tenon-core-test-data-"))
afterAll(() => fs.rm(data, { recursive: true, force: true }).catch(() => undefined))

process.env.XDG_DATA_HOME = data
process.env.TENON_DB = ":memory:"
process.env.TENON_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.TENON_DISABLE_MODELS_FETCH = "true"

// Test folders live under the temp folder. A test of the gate itself empties this list.
const { Global } = await import("@tenon/core/global")
const { ConfigTrust } = await import("@tenon/core/config/trust")
await fs.writeFile(ConfigTrust.file(Global.Path.data), JSON.stringify([await fs.realpath(os.tmpdir())]))
