import { z } from "zod/v4"
import { createJsonErrorResponseHandler } from "@ai-sdk/provider-utils"

export const openaiErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),

    type: z.string().nullish(),
    param: z.any().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
})

export type OpenAIErrorData = z.infer<typeof openaiErrorDataSchema>

export const openaiFailedResponseHandler: any = createJsonErrorResponseHandler({
  errorSchema: openaiErrorDataSchema,
  errorToMessage: (data) => data.error.message,
})
