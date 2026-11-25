import { describe, expect, test } from "bun:test"
import { AcpHarness } from "@tenon/core/harness/acp"
import { ProtocolError } from "@tenon/core/harness/codex-app-server"
import { Harness } from "@tenon/schema/harness"

const base = { id: Harness.InstanceID.make("gemini"), driver: Harness.AcpDriver, name: "Gemini" }

describe("AC-13 a late start check doesn't disable a harness", () => {
  test("a timed-out handshake leaves the harness available, marked slow to start", () => {
    const instance = AcpHarness.probeFailure(
      base,
      new ProtocolError("The ACP agent did not answer initialize within 8 seconds.", { timedOut: true }),
      [],
    )
    expect(instance.status).toBe("available")
    expect(instance.slowStart).toBe(true)
  })

  test("a protocol mismatch or a CLI that doesn't start still disables it, with the reason", () => {
    const mismatch = AcpHarness.probeFailure(base, new ProtocolError("Unsupported ACP protocol version: 2."), [])
    expect(mismatch.status).toBe("unavailable")
    expect(mismatch.error).toBe("Unsupported ACP protocol version: 2.")
    expect(mismatch.slowStart).toBeUndefined()
    const missing = AcpHarness.probeFailure(base, new Error("gemini isn't installed or isn't on PATH."), [])
    expect(missing.status).toBe("unavailable")
  })
})
