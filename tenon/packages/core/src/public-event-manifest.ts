export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@tenon/schema/event"
import { EventManifest } from "@tenon/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
