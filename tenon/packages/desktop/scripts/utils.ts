import { $ } from "bun"
import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { archiveFolder, archiveName, archiveURL, PLATFORM, VERSION } from "../../core/src/ripgrep/release"

const CLI_VERSION = "0.0.0-next-16350"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.TENON_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export const CLI_BINARIES: Array<{ rustTarget: string; package: string; os: string; cpu: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    package: "@opencode-ai/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    package: "@opencode-ai/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.rustTarget === target)
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

export async function downloadCliToResources() {
  const cli = getCurrentCli()
  const directory = await mkdtemp(join(tmpdir(), "opencode-cli-"))
  const dest = windowsify("resources/opencode-cli")
  try {
    await $`bun install --no-save --cwd ${directory} ${`${cli.package}@${CLI_VERSION}`} ${`--os=${cli.os}`} ${`--cpu=${cli.cpu}`}`
    await copyFile(
      join(directory, "node_modules", cli.package, "bin", cli.os === "win32" ? "opencode2.exe" : "opencode2"),
      dest,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${cli.package} to ${dest}`)
}

/** Puts the pinned, checksum-verified ripgrep for the build target in resources/ripgrep for electron-builder. */
export async function downloadRipgrepToResources() {
  const cli = getCurrentCli()
  const key = `${cli.cpu}-${cli.os}`
  if (!(key in PLATFORM)) throw new Error(`ripgrep is not available for ${key}`)
  const config = PLATFORM[key as keyof typeof PLATFORM]
  const binary = cli.os === "win32" ? "rg.exe" : "rg"
  const stamp = "resources/ripgrep/.version"
  if ((await readFile(stamp, "utf8").catch(() => "")) === `${VERSION}-${key}`) return

  const response = await fetch(archiveURL(config), { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`ripgrep download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash("sha256").update(bytes).digest("hex") !== config.sha256)
    throw new Error(`ripgrep checksum mismatch for ${archiveName(config)}`)

  const directory = await mkdtemp(join(tmpdir(), "tenon-ripgrep-"))
  try {
    const archive = join(directory, archiveName(config))
    await writeFile(archive, bytes)
    if (config.extension === "zip")
      await $`powershell -NoProfile -NonInteractive -Command ${`Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${directory.replaceAll("'", "''")}' -Force`}`
    else await $`tar -xzf ${archive} -C ${directory}`
    await rm("resources/ripgrep", { recursive: true, force: true })
    await mkdir("resources/ripgrep", { recursive: true })
    await copyFile(join(directory, archiveFolder(config), binary), join("resources/ripgrep", binary))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (cli.os !== "win32") await chmod(join("resources/ripgrep", binary), 0o755)
  await writeFile(stamp, `${VERSION}-${key}`)
  console.log(`Copied ripgrep ${VERSION} (${key}) to resources/ripgrep`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
