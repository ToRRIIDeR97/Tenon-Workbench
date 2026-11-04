import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"
import { detectDesktopNativeLocale } from "../app/src/i18n/desktop-native"

const channels = [
  { channel: "dev", appId: "io.github.torriider97.tenonworkbench.dev", name: "tenon-workbench-dev" },
  { channel: "beta", appId: "io.github.torriider97.tenonworkbench.beta", name: "tenon-workbench-beta" },
  { channel: "prod", appId: "io.github.torriider97.tenonworkbench", name: "tenon-workbench" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.TENON_CHANNEL
    process.env.TENON_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.TENON_CHANNEL
    else process.env.TENON_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toStartWith("Tenon Workbench")
    expect(config.publish).toBeNull()
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    // Nothing may reuse upstream OpenCode Desktop's identity.
    expect(config.extraMetadata?.name).toBe(channel.name)
    expect(config.deb?.packageName).toBe(channel.name)
    expect(config.rpm?.packageName).toBe(channel.name)
    expect(config.protocols).toEqual(expect.objectContaining({ schemes: ["tenon"] }))
    expect(JSON.stringify(config)).not.toContain("ai.opencode.desktop")
    expect(config.files).toContain("!out/**/*.map")
    expect(config.files).toContain("!**/node_modules/**/*.map")
    expect(config.files).toContain("!**/node_modules/effect/src/**")
    expect(config.files?.toString()).not.toContain("drizzle-orm")
  })
}

test("macOS builds explain microphone use for dictation", async () => {
  const module = await import("./electron-builder.config.ts?dictation")
  const config = module.default as Configuration
  expect(config.mac?.extendInfo).toEqual(
    expect.objectContaining({ NSMicrophoneUsageDescription: expect.stringContaining("dictation") }),
  )
})

test("keeps exactly the Chromium languages an app locale can detect", async () => {
  const module = await import("./electron-builder.config.ts?locales")
  const config = module.default as Configuration
  const kept = config.electronLanguages as string[]
  const trimmed = ["af", "fil", "gu", "he", "kn", "ml", "mr", "sw", "ta", "te"]

  expect(kept).toHaveLength(45)
  expect(kept).toContain("en-US")
  for (const locale of kept.filter((locale) => !locale.startsWith("en-"))) {
    expect([locale, detectDesktopNativeLocale([locale])]).not.toEqual([locale, "en"])
  }
  for (const locale of trimmed) expect(detectDesktopNativeLocale([locale])).toBe("en")
  // macOS names the same packs `pt_BR.lproj`; a hyphen would silently delete them.
  expect(config.mac?.electronLanguages).toEqual(expect.arrayContaining(["en", "pt_BR", "zh_TW", "es_419"]))
})
