export * as Session from "./session"

import { Schema } from "effect"
import { Agent } from "./agent"
import { Location } from "./location"
import { Model } from "./model"
import { Project } from "./project"
import { DateTimeUtcFromMillis, optional, RelativePath } from "./schema"
import { Harness } from "./harness"
import { SessionEvent } from "./session-event"
import { SessionID } from "./session-id"
import { Revert } from "./revert"

export const ID = SessionID
export type ID = SessionID

export const Event = SessionEvent

/** The thread that started a session without being its parent: a delegated task placed in a Project. */
export const Origin = Schema.Struct({
  sessionID: Schema.String,
  /** Whether that thread runs in the Command Centre's folder. */
  commandCentre: Schema.Boolean,
  /**
   * Started with `thread_start` and handed off: the thread is the user's, so it doesn't count toward the starter's
   * delegation depth, and the starter can't read or stop it as a task. A delegated task leaves this out.
   */
  handOff: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "SessionV2.Origin" })
export interface Origin extends Schema.Schema.Type<typeof Origin> {}

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  projectID: Project.ID,
  harnessInstanceID: Harness.InstanceID,
  harnessModel: Harness.ModelSelection.pipe(optional),
  harnessRevision: Schema.Finite.pipe(optional),
  origin: Origin.pipe(optional),
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(optional),
    // Derived from `metadata.pinned`; set through the session update endpoint.
    pinned: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  revert: Revert.State.pipe(optional),
}).annotate({ identifier: "SessionV2.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
}).annotate({ identifier: "Session.ListAnchor" })
export interface ListAnchor extends Schema.Schema.Type<typeof ListAnchor> {}
