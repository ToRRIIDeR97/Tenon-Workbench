# Tenon companion (`@tenon/mobile`)

The phone app: Tenon Workbench's renderer in a Capacitor 6 shell that pairs with Tenon Workbench on your
computer and then reads and steers its threads. The computer does the work; the phone is a window onto it.
Design and security notes: [architecture](../../../docs/architecture/README.md#mobile-companion),
[threat model](../../../docs/security/threat-model.md#remote-access).

## How it connects

1. On the computer: Settings › Servers › Phone access, turn on **Allow paired phones**, choose the address
   the phone can reach (home Wi-Fi or a VPN such as Tailscale), then **Pair a phone**.
2. On the phone: scan the QR code (where the web view offers a barcode detector), or type the address and
   the eight-character code. The app posts the code to `/remote/pair` and keeps the device token it gets
   back in the phone's secure storage (Android: a key in the Android Keystore seals it in the app's private
   preferences; iOS: the Keychain, this device only).
3. Every request to that computer then carries `Authorization: Bearer <token>`. The computer's server
   decides what a phone may do (the companion scope); terminals, settings and credentials stay on the
   computer.
4. Settings › Servers › This phone › **Sign out** forgets the token. Revoke the phone on the computer too.

The link is plain HTTP. Use it only on a network you trust.

## Build for Android

Needs: Bun 1.3.14, Node.js 22+, JDK 17 (Capacitor 6; Capacitor 7 needs JDK 21), the Android SDK with
platform 35, and an emulator or a phone with USB debugging.

```sh
cd tenon/packages/mobile
bun run build                         # renderer into dist/
node scripts/cap.cjs sync android     # copy it into the Android project
cd android
gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`scripts/cap.cjs` runs the Capacitor CLI with a shim: the workspace pins `tar` 7 for security, and the
Capacitor 6 CLI imports `tar`'s default export, which `tar` 7 no longer has.

Set `JAVA_HOME` to the JDK 17 folder and `ANDROID_HOME` to the SDK (on Windows
`%LOCALAPPDATA%\Android\jdk-17` and `%LOCALAPPDATA%\Android\Sdk` on this project's computer;
`android/local.properties` is not committed). On the emulator the computer running Tenon Workbench is
`10.0.2.2`, but pairing needs the address Phone access listens on; the emulator reaches the computer's
LAN address directly.

Nothing is published to Google Play.

## Build for iOS (written, never built)

There is no Mac in this project, so the iOS project has never been compiled or run. It was generated with
`node scripts/cap.cjs add ios` and then edited by hand:

- `ios/App/App/SecureStorePlugin.swift` (the Keychain store) and `TenonViewController.swift` (registers it),
  both added to `App.xcodeproj` and set as the main storyboard's view controller;
- `Info.plist`: `NSAppTransportSecurity › NSAllowsLocalNetworking` (plain HTTP to local addresses),
  `NSLocalNetworkUsageDescription` and `NSCameraUsageDescription`.

To try it you need a Mac with Xcode 15 or later, CocoaPods, and an Apple ID (a free one runs the app on
your own device for seven days):

```sh
cd tenon/packages/mobile
bun run build
node scripts/cap.cjs sync ios         # runs pod install on a Mac
open ios/App/App.xcworkspace          # pick your team under Signing, then Run
```

Known risks to check first on a Mac: the web view's origin is `capacitor://localhost`, and WebKit may treat
`fetch` to a plain-HTTP LAN address from it as mixed content; iOS asks for local network permission on the
first request; a host name ending in `.local` needs Bonjour. Nothing is published to the App Store.
