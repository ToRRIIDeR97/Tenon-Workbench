import { Config, Effect, Formatter, Layer, Schema, Stream } from "effect"
import { LLM, LLMClient, Message, ProviderID, Tool, ToolRuntime } from "@tenon/llm"
import { Route, Auth, Endpoint, Framing, Protocol, RequestExecutor, WebSocketExecutor } from "@tenon/llm/route"
import { OpenAI } from "@tenon/llm/providers"

const apiKey = Config.Redacted("OPENAI_API_KEY")

const model = OpenAI.configure({
  apiKey,
  generation: { maxTokens: 160 },
  providerOptions: {
    openai: { store: false },
  },
}).model("gpt-4o-mini")

const request = LLM.request({
  model,
  system: "You are concise and practical.",
  prompt: "Tell me a joke",
  generation: { maxTokens: 80, temperature: 0.7 },
  providerOptions: {
    openai: { promptCacheKey: "tutorial-joke" },
  },
})

const rawOverlayExample = LLM.request({
  model,
  prompt: "Show the final HTTP overlay shape.",
  http: {
    body: { metadata: { example: "tutorial" } },
    headers: { "x-tenon-tutorial": "1" },
    query: { debug: "1" },
  },
})

const generateOnce = Effect.gen(function* () {
  const response = yield* LLM.generate(request)

  console.log("\n== generate ==")
  console.log("generated text:", response.text)
  console.log("usage", Formatter.formatJson(response.usage, { space: 2 }))
})

const streamText = LLM.stream(request).pipe(
  Stream.tap((event) =>
    Effect.sync(() => {
      if (event.type === "text-delta") process.stdout.write(`\ntext: ${event.text}`)
      if (event.type === "finish") process.stdout.write(`\nfinish: ${event.reason}\n`)
    }),
  ),
  Stream.runDrain,
)

const tools = {
  get_weather: Tool.make({
    description: "Get current weather for a city.",
    parameters: Schema.Struct({ city: Schema.String }),
    success: Schema.Struct({ forecast: Schema.String }),
    execute: (input) => Effect.succeed({ forecast: `${input.city}: sunny, 72F` }),
  }),
}

const streamWithTools = Effect.gen(function* () {
  const request = LLM.request({
    model,
    prompt: "Use get_weather for San Francisco, then answer in one sentence.",
    generation: { maxTokens: 80, temperature: 0 },
    tools: Tool.toDefinitions(tools),
  })
  const events = Array.from(yield* LLM.stream(request).pipe(Stream.runCollect))
  for (const event of events) {
    if (event.type === "tool-call") console.log("tool call", event.name, event.input)
    if (event.type === "text-delta") process.stdout.write(event.text)
    if (event.type !== "tool-call" || event.providerExecuted) continue
    const dispatched = yield* ToolRuntime.dispatch(tools, event)
    console.log("tool result", event.name, dispatched.result)

    const followUp = LLM.updateRequest(request, {
      messages: [
        ...request.messages,
        Message.assistant([event]),
        Message.tool({ ...event, result: dispatched.result }),
      ],
    })
    console.log("follow-up history messages:", followUp.messages.length)
  }
})

const WeatherReport = Schema.Struct({
  city: Schema.String,
  forecast: Schema.String,
  highFahrenheit: Schema.Number,
})

const generateStructuredObject = Effect.gen(function* () {
  const response = yield* LLM.generateObject({
    model,
    system: "Return only structured weather data.",
    prompt: "Give me today's weather for San Francisco.",
    schema: WeatherReport,
    generation: { maxTokens: 120, temperature: 0 },
  })

  console.log("\n== generateObject ==")
  console.log(Formatter.formatJson(response.object, { space: 2 }))
})

const generateDynamicObject = LLM.generateObject({
  model,
  prompt: "Extract the city and forecast from: San Francisco is sunny.",
  jsonSchema: {
    type: "object",
    properties: {
      city: { type: "string" },
      forecast: { type: "string" },
    },
    required: ["city", "forecast"],
  },
})

const FakeBody = Schema.Struct({
  model: Schema.String,
  input: Schema.String,
})
type FakeBody = Schema.Schema.Type<typeof FakeBody>

const FakeProtocol = Protocol.make<FakeBody, string, string, void>({
  id: "fake-echo",
  body: {
    schema: FakeBody,
    from: (request) =>
      Effect.succeed({
        model: request.model.id,
        input: request.messages
          .flatMap((message) => message.content)
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      }),
  },
  stream: {
    event: Schema.String,
    initial: () => undefined,
    step: (_, frame) => Effect.succeed([undefined, [{ type: "text-delta", id: "text-0", text: frame }]] as const),
    onHalt: () => [{ type: "finish", reason: "stop" }],
  },
})

const FakeAdapter = Route.make({
  id: "fake-echo",
  provider: "fake-echo",
  protocol: FakeProtocol,
  endpoint: Endpoint.path("/v1/echo", { baseURL: "https://fake.local" }),
  auth: Auth.passthrough,
  framing: Framing.sse,
})

const FakeEcho = {
  id: ProviderID.make("fake-echo"),
  configure: () => ({
    id: ProviderID.make("fake-echo"),
    model: (id: string) => FakeAdapter.model({ id }),
  }),
}

const inspectFakeProvider = Effect.gen(function* () {
  const prepared = yield* LLMClient.prepare(
    LLM.request({
      model: FakeEcho.configure().model("tiny-echo"),
      prompt: "Show me the provider pipeline.",
    }),
  )

  console.log("\n== fake provider prepare ==")
  console.log("route:", prepared.route)
  console.log("body:", Formatter.formatJson(prepared.body, { space: 2 }))
})

const requestExecutorLayer = RequestExecutor.fetchLayer
const llmDeps = Layer.mergeAll(requestExecutorLayer, WebSocketExecutor.layer)
const llmClientLayer = LLMClient.layer.pipe(Layer.provide(llmDeps))

const program = Effect.gen(function* () {
  yield* streamWithTools
}).pipe(Effect.provide(Layer.mergeAll(llmDeps, llmClientLayer)))

Effect.runPromise(program)
