export const sseEvents = (...chunks: ReadonlyArray<unknown>): string =>
  `${chunks.map(formatChunk).join("")}data: [DONE]\n\n`

const formatChunk = (chunk: unknown) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`

export const sseRaw = (...lines: ReadonlyArray<string>): string => lines.map((line) => `${line}\n\n`).join("")
