import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { FSUtil } from "@tenon/core/fs-util"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Effect } from "effect"
import path from "path"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Git } from "../../src/git"
import { Vcs } from "@/project/vcs"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Vcs.node, Git.node, EventV2Bridge.node, FSUtil.node, CrossSpawnSpawner.node])),
)

const run = (cwd: string, args: string[]) => Git.Service.use((git) => git.run(args, { cwd }))
const write = (file: string, content: string) => FSUtil.Service.use((fs) => fs.writeWithDirs(file, content))

describe("AC-22/AC-23 Vcs commit and push", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "commits every change, refuses an empty message and an empty commit",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* Vcs.Service
        yield* vcs.init()
        yield* write(path.join(test.directory, "a.txt"), "one\n")
        yield* write(path.join(test.directory, "dir", "b.txt"), "two\n")
        expect((yield* vcs.commit({ message: "  " }).pipe(Effect.flip)).reason).toBe("invalid")
        const done = yield* vcs.commit({ message: "Add files" })
        expect(done.sha).toMatch(/^[0-9a-f]{40}$/)
        const log = yield* run(test.directory, ["log", "-1", "--format=%s"])
        expect(log.text().trim()).toBe("Add files")
        const status = yield* run(test.directory, ["status", "--porcelain"])
        expect(status.text().trim()).toBe("")
        expect((yield* vcs.commit({ message: "Again" }).pipe(Effect.flip)).reason).toBe("nothing")
      }),
    { git: true },
  )

  it.instance(
    "commits onto a new branch when one is named, and refuses a bad name",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* Vcs.Service
        yield* vcs.init()
        yield* write(path.join(test.directory, "c.txt"), "three\n")
        expect((yield* vcs.commit({ message: "x", branch: "--force" }).pipe(Effect.flip)).reason).toBe("invalid-branch")
        const done = yield* vcs.commit({ message: "On a branch", branch: "tenon/feature" })
        expect(done.branch).toBe("tenon/feature")
        expect(yield* vcs.branch()).toBe("tenon/feature")
      }),
    { git: true },
  )

  it.instance(
    "push without an origin remote says so",
    () =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        yield* vcs.init()
        expect((yield* vcs.push().pipe(Effect.flip)).reason).toBe("no-remote")
      }),
    { git: true },
  )

  it.instance("outside git, commit and push refuse", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      yield* vcs.init()
      expect((yield* vcs.commit({ message: "x" }).pipe(Effect.flip)).reason).toBe("non-git")
      expect((yield* vcs.push().pipe(Effect.flip)).reason).toBe("non-git")
    }),
  )
})
