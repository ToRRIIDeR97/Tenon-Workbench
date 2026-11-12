import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMEvent } from "@tenon/llm"
import { approve, handleCodexRequest, markBlocked, turnGate, type Blocked, type StreamInput } from "../src/harness"
import { handleRequest, type PermissionRequest } from "../src/harness/acp"
import { PermissionV2 } from "../src/permission"
import { SessionID } from "@tenon/schema/session-id"

const sessionID = SessionID.make("ses_permission_source")

describe("harness approvals", () => {
  test("link a Codex approval to the item it gates", async () => {
    const asserted: PermissionV2.AssertInput[] = []
    const permissions = {
      assert: (input: PermissionV2.AssertInput) => Effect.sync(() => void asserted.push(input)),
    } as unknown as PermissionV2.Interface
    const input: StreamInput = {
      sessionID,
      directory: "/work",
      request: {} as StreamInput["request"],
      permissionSource: (callID) => Effect.succeed({ type: "tool", messageID: "msg_1", callID }),
    }
    const result: unknown = await Effect.runPromise<unknown, unknown>(
      handleCodexRequest(
        { method: "item/commandExecution/requestApproval", params: { itemId: "item_7", command: "ls" } },
        input,
        permissions,
        () => Effect.succeed(undefined),
        turnGate().guard,
      ),
    )
    expect(result).toEqual({ decision: "accept" })
    expect(asserted[0]?.source).toEqual({ type: "tool", messageID: "msg_1", callID: "item_7" })
  })

  test("ask a Codex question through the withdrawable asker, and answer nothing once it is withdrawn", async () => {
    const asked: unknown[] = []
    const request = (answers: ReadonlyArray<ReadonlyArray<string>> | undefined) =>
      Effect.runPromise<unknown, unknown>(
        handleCodexRequest(
          {
            method: "item/tool/requestUserInput",
            params: { questions: [{ id: "q1", header: "Pick", question: "Which?", options: [{ label: "A" }] }] },
          },
          { sessionID, directory: "/work", request: {} as StreamInput["request"] },
          {} as PermissionV2.Interface,
          (prompts) => Effect.sync(() => asked.push(...prompts)).pipe(Effect.as(answers)),
          turnGate().guard,
        ),
      )
    expect(await request([["A"]])).toEqual({ answers: { q1: { answers: ["A"] } } })
    expect(await request(undefined)).toEqual({ answers: { q1: { answers: [] } } })
    expect(asked[0]).toMatchObject({ header: "Pick", question: "Which?" })
  })

  // Codex 0.164 asks the client to approve each MCP tool call with `mcpServer/elicitation/request`; an
  // unanswered method reads as "user rejected MCP tool call", so a forwarded server could never run.
  test("approve a Codex MCP tool call through the approval card", async () => {
    const asserted: PermissionV2.AssertInput[] = []
    const run = (allow: boolean) =>
      Effect.runPromise<unknown, unknown>(
        handleCodexRequest(
          {
            method: "mcpServer/elicitation/request",
            params: {
              threadId: "t1",
              turnId: "u1",
              serverName: "tenoncheck",
              mode: "form",
              _meta: null,
              message: "Allow tenoncheck to run the ping tool?",
              requestedSchema: { type: "object", properties: {} },
            },
          },
          { sessionID, directory: "/work", request: {} as StreamInput["request"] },
          {
            assert: (input: PermissionV2.AssertInput) =>
              Effect.sync(() => void asserted.push(input)).pipe(
                Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.DeclinedError())),
              ),
          } as unknown as PermissionV2.Interface,
          () => Effect.succeed(undefined),
          turnGate().guard,
        ),
      )
    expect(await run(true)).toEqual({ action: "accept", content: {}, _meta: null })
    expect(await run(false)).toEqual({ action: "decline", content: null, _meta: null })
    expect(asserted[0]).toMatchObject({ action: "mcp", resources: ["tenoncheck"] })
    expect(asserted[0]?.metadata).toMatchObject({ harness: "codex", message: "Allow tenoncheck to run the ping tool?" })
  })

  test("ask a Codex MCP form in the dock and decline a link", async () => {
    const asked: unknown[] = []
    const run = (params: Record<string, unknown>) =>
      Effect.runPromise<unknown, unknown>(
        handleCodexRequest(
          {
            method: "mcpServer/elicitation/request",
            params: { threadId: "t1", turnId: null, serverName: "s", _meta: null, ...params },
          },
          { sessionID, directory: "/work", request: {} as StreamInput["request"] },
          {} as PermissionV2.Interface,
          (prompts) => Effect.sync(() => asked.push(...prompts)).pipe(Effect.as([["Blue"]])),
          turnGate().guard,
        ),
      )
    const form = await run({
      mode: "form",
      message: "Pick a colour",
      requestedSchema: { type: "object", properties: { colour: { type: "string", enum: ["Blue", "Red"] } } },
    })
    expect(form).toEqual({ action: "accept", content: { colour: "Blue" }, _meta: null })
    expect(asked.length).toBe(1)
    expect(await run({ mode: "url", message: "Sign in", url: "https://example.com", elicitationId: "e1" })).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    })
  })

  test("pass the ACP toolCallId with the permission request", async () => {
    const requests: PermissionRequest[] = []
    await Effect.runPromise(
      handleRequest(
        {
          id: 1,
          method: "session/request_permission",
          params: {
            toolCall: { toolCallId: "call_3", kind: "execute", title: "ls" },
            options: [{ kind: "allow_once", optionId: "yes" }],
          },
        },
        (request) => Effect.sync(() => requests.push(request)).pipe(Effect.as(true)),
      ),
    )
    expect(requests[0]?.callID).toBe("call_3")
  })
})

describe("harness approvals blocked without asking", () => {
  const assertion = { sessionID, action: "bash", resources: ["echo hello"] } satisfies PermissionV2.AssertInput
  const outcome = async (assert: Effect.Effect<void, unknown>) => {
    const blocked: Blocked[] = []
    const permissions = { assert: () => assert } as unknown as PermissionV2.Interface
    const allowed = await Effect.runPromise(approve(permissions, assertion, (item) => blocked.push(item)))
    return { allowed, blocked }
  }

  test("a deny rule or a failed check blocks the call; only the user's reply declines it", async () => {
    expect(await outcome(Effect.void)).toEqual({ allowed: true, blocked: [] })
    expect(await outcome(Effect.fail(new PermissionV2.BlockedError({ rules: [] })))).toEqual({
      allowed: false,
      blocked: [{ reason: "rules", action: "bash" }],
    })
    expect(await outcome(Effect.die(new Error("database closed")))).toEqual({
      allowed: false,
      blocked: [{ reason: "error", action: "bash" }],
    })
    // The user's Reject arrives as a defect (assert dies on DeclinedError) or, with feedback, as CorrectedError.
    expect(await outcome(Effect.die(new PermissionV2.DeclinedError()))).toEqual({ allowed: false, blocked: [] })
    expect(await outcome(Effect.fail(new PermissionV2.CorrectedError({ feedback: "no" })))).toEqual({
      allowed: false,
      blocked: [],
    })
    expect(await outcome(Effect.interrupt)).toEqual({ allowed: false, blocked: [] })
  })

  test("a blocked call's failed result says it was blocked instead of declined", () => {
    const blocked = new Map<string, Blocked>([["call_1", { reason: "rules", action: "bash" }]])
    const failed = (id: string) =>
      LLMEvent.toolResult({
        id,
        name: "acp_execute",
        providerExecuted: true,
        result: { type: "error", value: "The user declined this tool call" },
      })
    expect(markBlocked(failed("call_1"), blocked)).toMatchObject({
      result: { type: "error", value: "Blocked by permission rules: bash" },
      providerMetadata: { tenon: { blocked: { reason: "rules", action: "bash" } } },
    })
    // A call the user declined keeps the agent's wording.
    expect(markBlocked(failed("call_2"), blocked)).toEqual(failed("call_2"))
  })
})
