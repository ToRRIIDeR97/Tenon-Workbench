const FIXTURE_ID = "chatcmpl_fixture"

export const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: FIXTURE_ID,
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

export const usageChunk = (usage: object) => ({
  id: FIXTURE_ID,
  choices: [],
  usage,
})

export const finishChunk = (reason: string) => deltaChunk({}, reason)

export const toolCallChunk = (id: string, name: string, args: string, index = 0) =>
  deltaChunk({
    role: "assistant",
    tool_calls: [{ index, id, function: { name, arguments: args } }],
  })
