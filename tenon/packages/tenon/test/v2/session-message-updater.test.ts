import { expect, test } from "bun:test"
import { Effect } from "effect"
import * as DateTime from "effect/DateTime"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "@tenon/core/event"
import { SessionEvent } from "@tenon/core/session/event"
import { SessionMessageUpdater } from "@tenon/core/session/message-updater"
import { SessionMessage } from "@tenon/core/session/message"

test("compaction events reduce to compaction message only when completed", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()
  const compactionID = SessionMessage.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id,
      type: "session.next.compaction.started",
      data: {
        sessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(1),
        reason: "auto",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toEqual([])

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.compaction.delta",
      data: {
        sessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(2),
        text: "hello ",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.compaction.delta",
      data: {
        sessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(3),
        text: "summary",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.compaction.ended",
      data: {
        sessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(4),
        reason: "auto",
        text: "final summary",
        recent: "recent context",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toHaveLength(1)
  expect(state.messages[0]).toMatchObject({
    id: compactionID,
    type: "compaction",
    reason: "auto",
    summary: "final summary",
    recent: "recent context",
    time: { created: DateTime.makeUnsafe(4) },
  })
})
