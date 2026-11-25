import type { SharedV3ProviderMetadata } from "@ai-sdk/provider"

export type MetadataExtractor = {
  extractMetadata: ({ parsedBody }: { parsedBody: unknown }) => Promise<SharedV3ProviderMetadata | undefined>

  createStreamExtractor: () => {
    processChunk(parsedChunk: unknown): void

    buildMetadata(): SharedV3ProviderMetadata | undefined
  }
}
