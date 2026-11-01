import type { ElectronAPI } from "../preload/types"

declare global {
  interface TenonDesktopAPI extends ElectronAPI {}
  interface Window {
    __TENON__?: {
      deepLinks?: string[]
    }
  }
}
