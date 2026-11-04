// `git diff` misses new files. `git status` is no substitute: under core.autocrlf it reports
// regenerated LF files as modified even when their content is unchanged.
import { $ } from "bun"

const dirs = ["src/generated", "src/generated-effect"]
const changed = await $`git diff --name-only -- ${dirs}`.text()
const untracked = await $`git ls-files --others --exclude-standard -- ${dirs}`.text()
const stale = (changed + untracked).trim()
if (stale) {
  console.error(`Generated client is stale. Commit the output of \`bun run generate\`:\n${stale}`)
  process.exit(1)
}
