// Acceptance fixture for P2 (implementations/notes-command-centre): speaks the tenon-dictation
// JSON-lines protocol without audio or models. FAKE_DICTATION_CRASH=1 exits right after "start".
import { createInterface } from "node:readline"

const send = (event) => process.stdout.write(JSON.stringify(event) + "\n")
send({ type: "ready" })
let recording = false

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line)
  if (request.type === "load") return send({ type: "ready" })
  if (request.type === "start") {
    recording = true
    if (process.env.FAKE_DICTATION_CRASH === "1") process.exit(3)
    return send({ type: "level", rms: 0.4 })
  }
  if (request.type === "stop") {
    if (!recording) return send({ type: "error", id: request.id, code: "not_recording", message: "Not recording" })
    recording = false
    return send({ type: "final", id: request.id, text: "hello from the fake engine" })
  }
  if (request.type === "cancel") {
    recording = false
    return
  }
  send({ type: "error", id: request.id, code: "bad_request", message: `Unknown request ${request.type}` })
})
