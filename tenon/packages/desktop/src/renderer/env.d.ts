import type { ElectronAPI } from "../preload/types"

declare global {
  interface OpenCodeDesktopAPI extends ElectronAPI {}
  interface Window {
    __TENON__?: {
      deepLinks?: string[]
    }
  }
}
