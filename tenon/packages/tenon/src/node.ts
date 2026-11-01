// Must run first: maps pre-rename OPENCODE_* variables to TENON_* before other modules read them.
import "@tenon/core/legacy-env"
export { Config } from "@/config/config"
export { Server } from "./server/server"
export { bootstrap } from "./cli/bootstrap"
export { Database } from "@tenon/core/database/database"
