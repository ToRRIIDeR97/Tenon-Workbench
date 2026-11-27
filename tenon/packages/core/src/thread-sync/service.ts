import os from "node:os"
import path from "node:path"
import { SessionStatusEvent } from "@tenon/schema/session-status-event"
import { Context, Effect, Layer, Stream } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Global } from "../global"
import { ProjectV2 } from "../project"
import { AbsolutePath } from "../schema"
import { bridgeCredentials } from "./bridge"
import { manager } from "./manager"
import type { Credentials, Manager } from "./manager"

export const SETTINGS_FILE = "thread-sync.json"

export class Service extends Context.Service<Service, Manager>()("@tenon/ThreadSync") {}

export const layerWith = (credentials: Credentials, hostname = os.hostname()) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const global = yield* Global.Service
      const projects = yield* ProjectV2.Service
      const sync = manager({
        db: database.db,
        events,
        settingsFile: path.join(global.config, SETTINGS_FILE),
        credentials,
        projects: {
          resolve: (directory) =>
            Effect.runPromise(
              projects
                .resolve(AbsolutePath.make(directory))
                .pipe(Effect.map((project) => ({ id: String(project.id), worktree: String(project.directory) }))),
            ),
        },
        hostname,
      })
      yield* events.subscribe(SessionStatusEvent.Idle).pipe(
        Stream.runForEach((event) => sync.settled(event.data.sessionID)),
        Effect.forkScoped,
      )
      return Service.of(sync)
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.suspend(() => layerWith(bridgeCredentials(process.env))),
  deps: [Database.node, EventV2.node, Global.node, ProjectV2.node],
})
