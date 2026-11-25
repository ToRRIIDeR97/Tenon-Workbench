export const iconNames = [
  "vscode",
  "cursor",
  "zed",
  "file-explorer",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "antigravity",
  "textmate",
  "powershell",
  "sublime-text",
] as const

export type IconName = (typeof iconNames)[number]
