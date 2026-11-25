import os from "os"
import path from "path"
import fs from "fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { afterAll } from "bun:test"

const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
afterAll(async () => {
  const { AppRuntime } = await import("../src/effect/app-runtime")
  await AppRuntime.dispose()

  const busy = (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
  const rm = async (left: number): Promise<void> => {
    Bun.gc(true)
    await sleep(100)
    return fs.rm(dir, { recursive: true, force: true }).catch((error) => {
      if (!busy(error)) throw error
      if (left <= 1 && process.platform !== "win32") throw error
      if (left <= 1) return
      return rm(left - 1)
    })
  }

  await rm(30)
})

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")
process.env["TENON_MODELS_PATH"] = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")
process.env["TENON_EXPERIMENTAL_EVENT_SYSTEM"] = "true"
process.env["TENON_EXPERIMENTAL_WORKSPACES"] = "true"

const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["TENON_TEST_HOME"] = testHome

const testManagedConfigDir = path.join(dir, "managed")
process.env["TENON_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

const cacheDir = path.join(dir, "cache", "opencode")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "14")

delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
delete process.env["GOOGLE_API_KEY"]
delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
delete process.env["AZURE_OPENAI_API_KEY"]
delete process.env["AWS_ACCESS_KEY_ID"]
delete process.env["AWS_PROFILE"]
delete process.env["AWS_REGION"]
delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
delete process.env["OPENROUTER_API_KEY"]
delete process.env["LLM_GATEWAY_API_KEY"]
delete process.env["GROQ_API_KEY"]
delete process.env["MISTRAL_API_KEY"]
delete process.env["PERPLEXITY_API_KEY"]
delete process.env["TOGETHER_API_KEY"]
delete process.env["XAI_API_KEY"]
delete process.env["DEEPSEEK_API_KEY"]
delete process.env["FIREWORKS_API_KEY"]
delete process.env["CEREBRAS_API_KEY"]
delete process.env["SAMBANOVA_API_KEY"]
delete process.env["TENON_SERVER_PASSWORD"]
delete process.env["TENON_SERVER_USERNAME"]
delete process.env["TENON_EXPERIMENTAL"]
delete process.env["TENON_ENABLE_EXPERIMENTAL_MODELS"]
delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
delete process.env["OTEL_EXPORTER_OTLP_HEADERS"]
delete process.env["OTEL_RESOURCE_ATTRIBUTES"]

process.env["TENON_DB"] = ":memory:"

const { initProjectors } = await import("../src/server/projectors")

initProjectors()

const { Global } = await import("@tenon/core/global")
const { ConfigTrust } = await import("@tenon/core/config/trust")
await fs.writeFile(ConfigTrust.file(Global.Path.data), JSON.stringify([await fs.realpath(os.tmpdir())]))
