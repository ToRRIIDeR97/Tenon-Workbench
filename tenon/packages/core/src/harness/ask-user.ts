export * as HarnessAskUser from "./ask-user"

import { Effect, Schema } from "effect"
import { QuestionV2 } from "../question"
import { SessionSchema } from "../session/schema"
import { QuestionTool } from "../tool/question"

export const WAIT_SECONDS = 240

export const SHORT_WAIT_SECONDS = 50

export const ELICITATION_WAIT_SECONDS = 24 * 60 * 60

export const Input = Schema.Struct({ questions: Schema.Array(QuestionV2.Prompt) })

export type Outcome =
  | { readonly type: "answered"; readonly answers: ReadonlyArray<QuestionV2.Answer> }
  | { readonly type: "declined" }
  | { readonly type: "open" }

export type Ask = (questions: ReadonlyArray<QuestionV2.Prompt>, waitSeconds: number) => Promise<Outcome>

export interface Asker {
  readonly ask: Ask
  readonly endTurn: Effect.Effect<void>
  readonly pending: () => boolean
}

interface Open {
  readonly key: string
  readonly id: QuestionV2.ID
  readonly outcome: Promise<Exclude<Outcome, { type: "open" }>>
  settled: boolean
}

export const make = Effect.fn("HarnessAskUser.make")(function* (
  questions: QuestionV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const state: { open?: Open } = {}
  const context = yield* Effect.context()
  const run = Effect.runPromiseWith(context)
  const withdraw = (open: Open | undefined) =>
    open && !open.settled ? questions.reject(open.id).pipe(Effect.ignore, Effect.provideContext(context)) : Effect.void
  yield* Effect.addFinalizer(() => withdraw(state.open))

  const start = (key: string, prompts: ReadonlyArray<QuestionV2.Prompt>) => {
    const id = QuestionV2.ID.ascending()
    const open: Open = {
      key,
      id,
      settled: false,
      outcome: run(
        questions.ask({ id, sessionID, questions: prompts }).pipe(
          Effect.map((answers) => ({ type: "answered" as const, answers })),
          Effect.catchTag("QuestionV2.RejectedError", () => Effect.succeed({ type: "declined" as const })),
        ),
      ),
    }
    const settle = () => {
      open.settled = true
    }
    void open.outcome.then(settle, settle)
    return open
  }

  const ask: Ask = async (prompts, waitSeconds) => {
    const key = JSON.stringify(prompts)
    const current = state.open
    const open = current?.key === key ? current : start(key, prompts)
    if (open !== current) {
      state.open = open
      await run(withdraw(current))
    }
    const outcome = await settleWithin(open.outcome, waitSeconds)
    if (outcome.type !== "open" && state.open === open) state.open = undefined
    return outcome
  }
  const endTurn = Effect.suspend(() => {
    const open = state.open
    state.open = undefined
    return withdraw(open)
  })
  return { ask, endTurn, pending: () => !!state.open && !state.open.settled } satisfies Asker
})

export function resultText(questions: ReadonlyArray<QuestionV2.Prompt>, outcome: Outcome) {
  if (outcome.type === "answered") return QuestionTool.toModelOutput(questions, outcome.answers)
  if (outcome.type === "declined")
    return "The user declined to answer these questions. Continue with your best judgement, or ask in chat."
  return "The question is still open in Tenon and the user has not answered yet. Call ask_user again with the same questions to keep waiting (the user is not asked twice), or continue without the answer."
}

async function settleWithin<A>(promise: Promise<A>, waitSeconds: number): Promise<A | { readonly type: "open" }> {
  const timer: { id?: ReturnType<typeof setTimeout> } = {}
  const timeout = new Promise<{ readonly type: "open" }>((resolve) => {
    timer.id = setTimeout(() => resolve({ type: "open" }), waitSeconds * 1_000)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer.id))
}
