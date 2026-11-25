import { SecondBrainRequestError } from "@/features/second-brain/client"

export function instructionsErrorKey(cause: unknown) {
  if (!(cause instanceof SecondBrainRequestError)) return "secondBrain.error.request" as const
  if (cause.reason === "outside_workspace") return "secondBrain.instructions.error.outsideFolder" as const
  if (cause.reason === "too_large") return "secondBrain.instructions.error.tooLarge" as const
  if (cause.status === 404) return "secondBrain.instructions.error.folderMissing" as const
  return "secondBrain.error.request" as const
}
