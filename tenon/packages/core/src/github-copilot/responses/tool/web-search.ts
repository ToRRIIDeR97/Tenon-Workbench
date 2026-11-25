import { createProviderToolFactory } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"

export const webSearchArgsSchema = z.object({
  filters: z
    .object({
      allowedDomains: z.array(z.string()).optional(),
    })
    .optional(),

  searchContextSize: z.enum(["low", "medium", "high"]).optional(),

  userLocation: z
    .object({
      type: z.literal("approximate"),
      country: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
})

export const webSearchToolFactory = createProviderToolFactory<
  {},
  {
    filters?: {
      allowedDomains?: string[]
    }

    searchContextSize?: "low" | "medium" | "high"

    userLocation?: {
      type: "approximate"
      country?: string
      city?: string
      region?: string
      timezone?: string
    }
  }
>({
  id: "openai.web_search",
  inputSchema: z.object({
    action: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("search"),
          query: z.string().nullish(),
        }),
        z.object({
          type: z.literal("open_page"),
          url: z.string(),
        }),
        z.object({
          type: z.literal("find"),
          url: z.string(),
          pattern: z.string(),
        }),
      ])
      .nullish(),
  }),
})

export const webSearch = (args: Parameters<typeof webSearchToolFactory>[0] = {}) => {
  return webSearchToolFactory(args)
}
