export * as HarnessEnv from "./env"

const allowlist = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "USERNAME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "ANTHROPIC_BASE_URL",
  "OPENAI_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "CLOUD_ML_REGION",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "SHELL",
  "SSH_AUTH_SOCK",
  "EDITOR",
  "VISUAL",
  "COLORTERM",
  "LC_CTYPE",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "ProgramData",
  "SystemRoot",
  "WINDIR",
  "SystemDrive",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
]

export function harnessEnvironment(
  configEnv: Readonly<Record<string, string | undefined>> = {},
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of allowlist) {
    const value = source[name]
    if (value) env[name] = value
  }
  for (const [name, value] of Object.entries(configEnv)) {
    if (value) env[name] = value
  }
  if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some((name) => env[name])) {
    const hosts = [...(env.NO_PROXY ?? env.no_proxy ?? "").split(","), "127.0.0.1", "localhost", "::1"]
      .map((host) => host.trim())
      .filter(Boolean)
    env.NO_PROXY = env.no_proxy = [...new Set(hosts)].join(",")
  }
  return env
}
