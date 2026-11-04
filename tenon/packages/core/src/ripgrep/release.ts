// The pinned ripgrep release, shared by the runtime download and the desktop build that bundles it.
// `sha256` is each archive's digest from the release's own `.sha256` assets, checked against the
// archives themselves. It has to change with VERSION; nothing here can check that offline.
export const VERSION = "15.1.0"
export const PLATFORM = {
  "arm64-darwin": {
    platform: "aarch64-apple-darwin",
    extension: "tar.gz",
    sha256: "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
  },
  "arm64-linux": {
    platform: "aarch64-unknown-linux-gnu",
    extension: "tar.gz",
    sha256: "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
  },
  "x64-darwin": {
    platform: "x86_64-apple-darwin",
    extension: "tar.gz",
    sha256: "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
  },
  "x64-linux": {
    platform: "x86_64-unknown-linux-musl",
    extension: "tar.gz",
    sha256: "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
  },
  "arm64-win32": {
    platform: "aarch64-pc-windows-msvc",
    extension: "zip",
    sha256: "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
  },
  "ia32-win32": {
    platform: "i686-pc-windows-msvc",
    extension: "zip",
    sha256: "725be85a1e8f92878a548f40ee4f6df64bc93b809586462b3c6d884e1de1e83a",
  },
  "x64-win32": {
    platform: "x86_64-pc-windows-msvc",
    extension: "zip",
    sha256: "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
  },
} as const

export type Config = (typeof PLATFORM)[keyof typeof PLATFORM]

export const archiveName = (config: Config) => `ripgrep-${VERSION}-${config.platform}.${config.extension}`
export const archiveURL = (config: Config) =>
  `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${archiveName(config)}`
/** The folder inside the archive that holds the executable. */
export const archiveFolder = (config: Config) => `ripgrep-${VERSION}-${config.platform}`
