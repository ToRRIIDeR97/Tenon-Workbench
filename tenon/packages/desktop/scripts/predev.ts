import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.TENON_CHANNEL ?? "dev"}`

await $`cd ../tenon && bun script/build-node.ts`
await downloadCliToResources()
