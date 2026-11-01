import { registerCustomTheme } from "@pierre/diffs"
import { TenonTheme } from "./marked-theme"

let registered = false

export function registerTenonTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Tenon", () => Promise.resolve(TenonTheme))
}
