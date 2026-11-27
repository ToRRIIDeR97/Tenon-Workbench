import { Schema } from "effect"

export const PairCode = Schema.Literals(["bad_code", "expired", "locked", "invalid_name"])
export type PairCode = typeof PairCode.Type

export class PairError extends Schema.TaggedError<PairError>()("RemoteAccess.PairError", {
  code: PairCode,
  message: Schema.String,
}) {}

const messages: Record<PairCode, string> = {
  bad_code: "That pairing code is not the current one",
  expired: "That pairing code has expired; make a new one",
  locked: "Too many wrong codes; make a new pairing code",
  invalid_name: "A device name is 1 to 64 characters",
}

export const pairError = (code: PairCode) => new PairError({ code, message: messages[code] })
