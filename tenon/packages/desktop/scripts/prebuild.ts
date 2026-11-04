#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../tenon && bun script/build-node.ts`
if (channel === "dev" && Bun.env.TENON_BUNDLE_CLI === "1") await downloadCliToResources()
