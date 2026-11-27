import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "dev.tenon.companion",
  appName: "Tenon",
  webDir: "dist",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "never",
  },
}

export default config
