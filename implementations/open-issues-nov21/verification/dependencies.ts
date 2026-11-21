// AC-13 (#259): every pinned dependency in tenon/ is at the newest release that satisfies `^current` and is at least
// three days old (bunfig's minimumReleaseAge), apart from the documented exclusions. Prints each one that isn't and
// exits 1. Run from anywhere: bun implementations/open-issues-nov21/verification/dependencies.ts
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const tenon = path.resolve(import.meta.dir, "../../../tenon")
const semver = createRequire(path.join(tenon, "packages/tenon/package.json"))("semver") as typeof import("semver")

const AGE_MS = 259_200 * 1000
const root = JSON.parse(readFileSync(path.join(tenon, "package.json"), "utf8"))
const patched = new Set(Object.keys(root.patchedDependencies ?? {}).map((key) => key.slice(0, key.lastIndexOf("@"))))
const overrides = new Set(Object.keys(root.overrides ?? {}))
// Held back on purpose; see implementation.md AC-13 and #259.
const held: Record<string, string> = {
  "@ai-sdk/google-vertex": "waits for the patched @ai-sdk/google",
  "@tanstack/solid-query": "<5.100",
  "@solidjs/meta": "0.29.4",
  "@solid-primitives/storage": "4.3.x",
  "ghostty-web": "git dependency",
  prettier: "a minor release reformats the repository",
}
const caps: Record<string, string> = { "@tanstack/solid-query": "<5.100.0", "@solid-primitives/storage": "<4.4.0" }

type Want = { name: string; version: string; where: string }
const wants: Want[] = []
const collect = (file: string, json: Record<string, unknown>) => {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries((json[field] ?? {}) as Record<string, string>))
      wants.push({ name, version, where: `${file} ${field}` })
  }
}
collect("package.json", root)
const catalog = (root.workspaces?.catalog ?? {}) as Record<string, string>
for (const [name, version] of Object.entries(catalog)) wants.push({ name, version, where: "package.json catalog" })
for (const dir of readdirSync(path.join(tenon, "packages"))) {
  const file = path.join(tenon, "packages", dir, "package.json")
  if (existsSync(file)) collect(`packages/${dir}/package.json`, JSON.parse(readFileSync(file, "utf8")))
}

const pinned = wants.filter((want) => semver.valid(want.version))
const names = [...new Set(pinned.map((want) => want.name))].filter(
  (name) => !patched.has(name) && !overrides.has(name) && !(name in held && !(name in caps)),
)

const now = Date.now()
const newest = new Map<string, string>()
const failures: string[] = []
await Promise.all(
  names.map(async (name, index) => {
    await new Promise((resolve) => setTimeout(resolve, (index % 40) * 25))
    const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`)
    if (!response.ok) return void failures.push(`${name}: registry ${response.status}`)
    const doc = (await response.json()) as { time?: Record<string, string>; versions?: Record<string, unknown> }
    const old = Object.keys(doc.versions ?? {}).filter((version) => {
      const time = doc.time?.[version]
      return time && now - Date.parse(time) >= AGE_MS
    })
    newest.set(name, old.join(" "))
  }),
)

const stale: string[] = []
for (const want of pinned) {
  const versions = newest.get(want.name)
  if (versions === undefined) continue
  const range = caps[want.name] ? `^${want.version} ${caps[want.name]}` : `^${want.version}`
  const best = semver.maxSatisfying(versions.split(" ").filter(Boolean), range)
  if (best && semver.gt(best, want.version)) stale.push(`${want.name} ${want.version} -> ${best}  (${want.where})`)
}

for (const line of failures) console.log(`ERROR ${line}`)
for (const line of stale.toSorted()) console.log(`STALE ${line}`)
console.log(`${pinned.length} pinned entries, ${names.length} packages checked, ${stale.length} stale`)
process.exit(stale.length > 0 || failures.length > 0 ? 1 : 0)
