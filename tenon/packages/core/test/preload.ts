import path from "path"

process.env.TENON_DB = ":memory:"
process.env.TENON_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.TENON_DISABLE_MODELS_FETCH = "true"
