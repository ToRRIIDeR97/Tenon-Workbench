import { expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { withProviderIdleTimeout } from "@tenon/core/harness"
import { AcpHarness } from "@tenon/core/harness/acp"
import { it } from "./lib/effect"

it.effect("fails a stalled provider and keeps responsive streams alive beyond two minutes", () =>
  Effect.gen(function* () {
    const stalled = yield* withProviderIdleTimeout(Stream.never).pipe(Stream.runDrain, Effect.flip, Effect.forkChild)
    yield* TestClock.adjust("2 minutes")
    const failure = yield* Fiber.join(stalled)
    expect(failure.message).toContain("stopped responding")
    const active = yield* withProviderIdleTimeout(
      Stream.fromIterable([1, 2, 3]).pipe(
        Stream.mapEffect((value) => Effect.sleep("50 seconds").pipe(Effect.as(value))),
      ),
    ).pipe(Stream.runCollect, Effect.forkChild)
    yield* TestClock.adjust("150 seconds")
    expect(yield* Fiber.join(active)).toEqual([1, 2, 3])
  }),
)

it.effect("fails a silent harness turn, but not while it is busy or still talking", () =>
  Effect.gen(function* () {
    const watch = <A>(stream: (heard: Effect.Effect<void>) => Stream.Stream<A, string>, busy: () => boolean) =>
      AcpHarness.failOnSilence(stream, busy, "silent")
    const silent = yield* watch(
      () => Stream.never,
      () => false,
    ).pipe(Stream.runDrain, Effect.flip, Effect.forkChild)
    yield* TestClock.adjust("10 minutes")
    expect(yield* Fiber.join(silent)).toBe("silent")

    const state = { busy: true }
    const paused = yield* watch(
      () => Stream.never,
      () => state.busy,
    ).pipe(Stream.runDrain, Effect.flip, Effect.forkChild)
    yield* TestClock.adjust("30 minutes")
    expect(paused.pollUnsafe()).toBeUndefined()
    state.busy = false
    yield* TestClock.adjust("10 minutes")
    expect(yield* Fiber.join(paused)).toBe("silent")

    const talking = yield* watch(
      (heard) =>
        Stream.fromIterable([1, 2, 3]).pipe(
          Stream.mapEffect((value) => Effect.sleep("6 minutes").pipe(Effect.as(value))),
          Stream.tap(() => heard),
        ),
      () => false,
    ).pipe(Stream.runCollect, Effect.forkChild)
    yield* TestClock.adjust("18 minutes")
    expect(yield* Fiber.join(talking)).toEqual([1, 2, 3])
  }),
)
