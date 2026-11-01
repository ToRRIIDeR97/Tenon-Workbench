import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["TENON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["TENON_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("TENON_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  TENON_AUTO_HEAP_SNAPSHOT: truthy("TENON_AUTO_HEAP_SNAPSHOT"),
  TENON_GIT_BASH_PATH: process.env["TENON_GIT_BASH_PATH"],
  TENON_CONFIG: process.env["TENON_CONFIG"],
  TENON_CONFIG_CONTENT: process.env["TENON_CONFIG_CONTENT"],
  TENON_DISABLE_AUTOUPDATE: truthy("TENON_DISABLE_AUTOUPDATE"),
  TENON_ALWAYS_NOTIFY_UPDATE: truthy("TENON_ALWAYS_NOTIFY_UPDATE"),
  TENON_DISABLE_PRUNE: truthy("TENON_DISABLE_PRUNE"),
  TENON_DISABLE_TERMINAL_TITLE: truthy("TENON_DISABLE_TERMINAL_TITLE"),
  TENON_SHOW_TTFD: truthy("TENON_SHOW_TTFD"),
  TENON_DISABLE_AUTOCOMPACT: truthy("TENON_DISABLE_AUTOCOMPACT"),
  TENON_DISABLE_MODELS_FETCH: truthy("TENON_DISABLE_MODELS_FETCH"),
  TENON_DISABLE_MOUSE: truthy("TENON_DISABLE_MOUSE"),
  TENON_FAKE_VCS: process.env["TENON_FAKE_VCS"],
  TENON_SERVER_PASSWORD: process.env["TENON_SERVER_PASSWORD"],
  TENON_SERVER_USERNAME: process.env["TENON_SERVER_USERNAME"],
  TENON_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("TENON_DISABLE_FFF"),

  // Experimental
  TENON_EXPERIMENTAL_FILEWATCHER: Config.boolean("TENON_EXPERIMENTAL_FILEWATCHER").pipe(Config.withDefault(false)),
  TENON_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("TENON_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  TENON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("TENON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  TENON_MODELS_URL: process.env["TENON_MODELS_URL"],
  TENON_MODELS_PATH: process.env["TENON_MODELS_PATH"],
  TENON_DB: process.env["TENON_DB"],

  TENON_WORKSPACE_ID: process.env["TENON_WORKSPACE_ID"],
  TENON_EXPERIMENTAL_WORKSPACES: enabledByExperimental("TENON_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get TENON_DISABLE_PROJECT_CONFIG() {
    return truthy("TENON_DISABLE_PROJECT_CONFIG")
  },
  get TENON_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("TENON_EXPERIMENTAL_REFERENCES")
  },
  get TENON_TUI_CONFIG() {
    return process.env["TENON_TUI_CONFIG"]
  },
  get TENON_CONFIG_DIR() {
    return process.env["TENON_CONFIG_DIR"]
  },
  get TENON_PURE() {
    return truthy("TENON_PURE")
  },
  get TENON_PERMISSION() {
    return process.env["TENON_PERMISSION"]
  },
  get TENON_PLUGIN_META_FILE() {
    return process.env["TENON_PLUGIN_META_FILE"]
  },
  get TENON_CLIENT() {
    return process.env["TENON_CLIENT"] ?? "cli"
  },
}
