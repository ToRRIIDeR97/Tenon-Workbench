import { describe, expect } from "bun:test"
import path from "node:path"
import { SessionStatusEvent } from "@tenon/schema/session-status-event"
import { Effect, Layer, Schedule } from "effect"
import { Database } from "../../src/database/database"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { EventV2 } from "../../src/event"
import { Global } from "../../src/global"
import { Location } from "../../src/location"
import { ProjectV2 } from "../../src/project"
import { AbsolutePath } from "../../src/schema"
import { SessionV2 } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionInput } from "../../src/session/input"
import { Prompt } from "../../src/session/prompt"
import { SessionProjector } from "../../src/session/projector"
import { SessionStore } from "../../src/session/store"
import { ThreadSync } from "../../src/thread-sync"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const it = testEffect(Layer.empty)

const scratch = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
)

const server = (root: string) => {
  const key = ThreadSync.generateKey().key
  const credentials: ThreadSync.Credentials = {
    key: async () => key,
    store: async (driveFolder) => ThreadSync.folderStore(path.join(root, "drives", driveFolder)),
  }
  return Layer.fresh(
    AppNodeBuilder.build(
      LayerNode.group([
        Database.node,
        EventV2.node,
        Global.node,
        ProjectV2.node,
        SessionProjector.node,
        SessionStore.node,
        SessionV2.node,
        ThreadSync.node,
      ]),
      [
        [Database.node, Database.layerFromPath(":memory:")],
        [ProjectV2.node, projects],
        [Global.node, Global.layerWith({ config: root })],
        [ThreadSync.node, ThreadSync.layerWith(credentials, "desk")],
        [SessionExecution.node, SessionExecution.noopLayer],
      ],
    ),
  )
}

describe("thread sync service", () => {
  it.live("pushes a thread when it becomes idle and keeps its settings in the config folder", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const events = yield* EventV2.Service
        const db = (yield* Database.Service).db
        const sync = yield* ThreadSync.Service
        const created = yield* session.create({
          location: Location.Ref.make({ directory: AbsolutePath.make("/desk/repo") }),
        })
        yield* session.prompt({ sessionID: created.id, prompt: Prompt.make({ text: "hello" }), resume: false })
        yield* SessionInput.promoteSteers(db, events, created.id, Number.MAX_SAFE_INTEGER)
        yield* sync.configure({ enabled: true, driveFolder: "My threads" })
        yield* events.publish(SessionStatusEvent.Idle, { sessionID: created.id })
        const listed = yield* sync
          .threads()
          .pipe(
            Effect.repeat({ until: (threads) => threads.length > 0, schedule: Schedule.spaced("20 millis") }),
            Effect.timeout("5 seconds"),
          )
        expect(listed[0]).toMatchObject({ sessionID: created.id, head: 2, mine: true, local: "current" })
        expect((yield* sync.status()).machine.id).toMatch(/^desk-[0-9a-f]{6}$/)
        const stored = yield* Effect.promise(() => Bun.file(path.join(tmp.path, ThreadSync.SETTINGS_FILE)).json())
        expect(stored).toMatchObject({ enabled: true, driveFolder: "My threads" })
      }).pipe(Effect.provide(server(tmp.path)))
    }),
  )
})
