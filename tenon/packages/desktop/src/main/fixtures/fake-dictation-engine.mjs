// Acceptance fixture for P2 (implementations/notes-command-centre): speaks the tenon-dictation
// JSON-lines protocol without audio or models. FAKE_DICTATION_CRASH=1 exits right after "start";
// FAKE_DICTATION_HANG_LOAD=1 never answers a "load"; FAKE_DICTATION_HANG_STOP=1 never answers a "stop".
// A recording sends one "partial" soon after "start"; a "start" with a language makes the final name it.
import { createInterface } from "node:readline"

const send = (event) => process.stdout.write(JSON.stringify(event) + "\n")
send({ type: "ready" })
let recording = false
let language

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line)
  if (request.type === "load") return process.env.FAKE_DICTATION_HANG_LOAD === "1" ? undefined : send({ type: "ready" })
  if (request.type === "start") {
    recording = true
    language = request.language
    if (process.env.FAKE_DICTATION_CRASH === "1") process.exit(3)
    send({ type: "level", rms: 0.4 })
    // A live transcript while recording (harness-ux-batch-2, AC-6).
    return setTimeout(() => recording && send({ type: "partial", text: "hello from" }), 20)
  }
  if (request.type === "stop") {
    if (!recording) return send({ type: "error", id: request.id, code: "not_recording", message: "Not recording" })
    recording = false
    if (process.env.FAKE_DICTATION_HANG_STOP === "1") return
    send({
      type: "final",
      id: request.id,
      text: language ? `hello (${language})` : "hello from the fake engine",
    })
    // A preview that finished after stop (FAKE_DICTATION_LATE_PARTIAL=1): the supervisor must drop it.
    if (process.env.FAKE_DICTATION_LATE_PARTIAL === "1") send({ type: "partial", text: "too late" })
    return
  }
  if (request.type === "cancel") {
    recording = false
    return
  }
  send({ type: "error", id: request.id, code: "bad_request", message: `Unknown request ${request.type}` })
})
