export type ComputerUseState = {
  enabled: boolean
  installed: boolean
  permissions: "granted" | "missing" | "unknown"
  platform: string
  grants?: { accessibility: boolean; screen: boolean }
  stopped?: number
}

/**
 * Who uses which computer use, by harness: Codex and Claude Code have their own; Tenon's built-in agent and the other
 * ACP harnesses get the Cua Driver through Tenon; anything else can't reach Tenon's tools and gets none.
 */
export function computerUseByHarness(harnesses: ReadonlyArray<{ id: string; name: string; driver: string }>) {
  const result = { own: [] as string[], tenon: ["Tenon"], none: [] as string[] }
  for (const harness of harnesses) {
    if (harness.id === "codex" || harness.id === "claude-code") result.own.push(harness.name)
    else if (harness.driver === "acp") result.tenon.push(harness.name)
    else if (harness.driver !== "opencode") result.none.push(harness.name)
  }
  return result
}

/** macOS: the two grants the driver needs, each with its Privacy & Security pane. */
export function grantRows(state: ComputerUseState) {
  return [
    {
      label: "secondBrain.computerUse.screen" as const,
      granted: state.grants?.screen ?? state.permissions === "granted",
      settings: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    },
    {
      label: "secondBrain.computerUse.accessibility" as const,
      granted: state.grants?.accessibility ?? state.permissions === "granted",
      settings: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    },
  ]
}

/** What the user still has to do for computer use to work, once the Project has it on (#333). */
export function computerUseNotice(state: ComputerUseState): "install" | "permissions" | undefined {
  if (!state.enabled) return undefined
  if (!state.installed) return "install"
  if (state.platform === "darwin" && state.permissions === "missing") return "permissions"
  return undefined
}

/** The Cua Driver's own install command for the platform (cua.ai). */
export function installCommand(platform: string) {
  return platform === "win32"
    ? "irm https://cua.ai/driver/install.ps1 | iex"
    : '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"'
}
