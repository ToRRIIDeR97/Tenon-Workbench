#!/usr/bin/env bun
import { Script } from "@tenon/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    // A string literal: parsing it on a first run beats evaluating a 6 MB object, and later runs skip it.
    TENON_MODELS_DEV: JSON.stringify(generated.modelsData),
    TENON_VERSION: `'${Script.version}'`,
    TENON_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "tenon-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
