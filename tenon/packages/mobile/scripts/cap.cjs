const path = require("node:path")

const cli = path.dirname(require.resolve("@capacitor/cli/package.json", { paths: [path.join(__dirname, "..")] }))
const tar = require(require.resolve("tar", { paths: [cli] }))
if (!tar.default) Object.defineProperty(tar, "default", { value: tar })
process.argv.splice(1, 1, path.join(cli, "bin", "capacitor"))
require(path.join(cli, "bin", "capacitor"))
