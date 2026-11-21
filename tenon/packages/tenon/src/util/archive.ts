import path from "path"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup.
    // Pass paths through environment variables and -LiteralPath to prevent command/wildcard injection.
    const cmd =
      "$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $env:TENON_ZIP_SRC -DestinationPath $env:TENON_ZIP_DEST -Force"
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], {
      env: { ...process.env, TENON_ZIP_SRC: winZipPath, TENON_ZIP_DEST: winDestDir },
    })
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
