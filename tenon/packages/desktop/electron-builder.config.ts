import { execFile, execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

const hasMacIdentity = (() => {
  if (process.platform !== "darwin") return true
  if (process.env.CSC_LINK || process.env.CSC_NAME) return true
  try {
    return execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }).includes(
      "Developer ID Application",
    )
  } catch {
    return false
  }
})()

const outputDir =
  process.platform === "darwin" && process.env.GITHUB_ACTIONS !== "true"
    ? path.join(os.homedir(), "Library", "Caches", "tenon-workbench", "dist")
    : "dist"

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const dictationDir = path.join(
  process.env.CARGO_TARGET_DIR ?? path.join(packageDir, "..", "dictation", "target"),
  "release",
)
const dictationEngine = process.platform === "win32" ? "tenon-dictation.exe" : "tenon-dictation"
const dictationResources = existsSync(path.join(dictationDir, dictationEngine))
  ? [{ from: dictationDir, to: "dictation", filter: [dictationEngine] }]
  : (console.warn(`tenon-dictation not found in ${dictationDir}; the package will have no dictation engine`), [])

const ripgrepResources = existsSync(path.join(packageDir, "resources", "ripgrep"))
  ? [{ from: "resources/ripgrep", to: "ripgrep", filter: ["rg", "rg.exe"] }]
  : (console.warn("ripgrep not found in resources/ripgrep; the package will download it on first search"), [])

const channel = (() => {
  const raw = process.env.TENON_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "io.github.torriider97.tenonworkbench.dev",
  beta: "io.github.torriider97.tenonworkbench.beta",
  prod: "io.github.torriider97.tenonworkbench",
} as const

const PACKAGE_NAMES = {
  dev: "tenon-workbench-dev",
  beta: "tenon-workbench-beta",
  prod: "tenon-workbench",
} as const

const CHROMIUM_LOCALES = [
  ..."am ar bg bn ca cs da de el en-GB en-US es es-419 et fa fi fr hi hr hu id it ja ko lt lv ms nb nl pl".split(" "),
  ..."pt-BR pt-PT ro ru sk sl sr sv th tr uk ur vi zh-CN zh-TW".split(" "),
]

const getBase = (appId: string): Configuration => ({
  artifactName: "tenon-workbench-${os}-${arch}.${ext}",
  publish: null,
  directories: {
    output: outputDir,
    buildResources: "resources",
  },
  extraMetadata: {
    name: PACKAGE_NAMES[channel],
    desktopName: `${appId}.desktop`,
  },
  electronLanguages: CHROMIUM_LOCALES,
  files: [
    "out/**/*",
    "!out/**/*.map",
    "!**/node_modules/**/*.map",
    "!**/node_modules/effect/src/**",
    "resources/**/*",
    "!resources/opencode-cli*",
    "!resources/ripgrep/**",
  ],
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  extraResources: [
    ...dictationResources,
    ...ripgrepResources,
    ...(channel === "dev" && process.env.TENON_BUNDLE_CLI === "1"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli", "opencode-cli.exe"],
          },
        ]
      : []),
  ],
  mac: {
    category: "public.app-category.developer-tools",
    electronLanguages: ["en", ...CHROMIUM_LOCALES.map((locale) => locale.replace("-", "_"))],
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    extendInfo: {
      NSMicrophoneUsageDescription: "Tenon Workbench uses the microphone for dictation, transcribed on this Mac.",
    },
    ...(hasMacIdentity ? { notarize: true } : { identity: "-", notarize: false }),
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Tenon Workbench",
    schemes: ["tenon"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Tenon Workbench Dev",
        deb: { packageName: PACKAGE_NAMES.dev, fpm: [metainfoFpm(appId)] },
        rpm: { packageName: PACKAGE_NAMES.dev, fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Tenon Workbench Beta",
        protocols: { name: "Tenon Workbench Beta", schemes: ["tenon"] },
        deb: { packageName: PACKAGE_NAMES.beta, fpm: [metainfoFpm(appId)] },
        rpm: { packageName: PACKAGE_NAMES.beta, fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Tenon Workbench",
        protocols: { name: "Tenon Workbench", schemes: ["tenon"] },
        deb: { packageName: PACKAGE_NAMES.prod, fpm: [metainfoFpm(appId)] },
        rpm: { packageName: PACKAGE_NAMES.prod, fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
