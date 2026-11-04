import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.TENON_CHANNEL ?? "dev"}`

await $`cd ../tenon && bun script/build-node.ts`
// Only the opt-in v2 sidecar runs the CLI.
if (process.env.TENON_BUNDLE_CLI === "1" || process.env.TENON_SIDECAR_V2 === "1") await downloadCliToResources()
