import path from "path"
import { fileURLToPath } from "url"
import { loadModelsData } from "./models-snapshot"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.TENON_MODELS_URL || "https://models.dev"
export const modelsData = await loadModelsData({
  url: `${modelsUrl}/api.json`,
  source: process.env.MODELS_DEV_API_JSON,
  snapshot: path.join(dir, "dist", "models-dev-snapshot.json"),
})
console.log("Loaded models.dev snapshot")
