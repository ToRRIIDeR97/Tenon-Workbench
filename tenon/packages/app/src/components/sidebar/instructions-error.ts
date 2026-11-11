import { SecondBrainRequestError } from "@/features/second-brain/client"

/** Why AGENTS.md could not be read or saved, as an i18n key: the server's reason when it gave one. */
export function instructionsErrorKey(cause: unknown) {
  if (!(cause instanceof SecondBrainRequestError)) return "secondBrain.error.request" as const
  // A symlinked AGENTS.md that points outside its folder is refused so it can't expose another file.
  if (cause.reason === "outside_workspace") return "secondBrain.instructions.error.outsideFolder" as const
  if (cause.reason === "too_large") return "secondBrain.instructions.error.tooLarge" as const
  if (cause.status === 404) return "secondBrain.instructions.error.folderMissing" as const
  return "secondBrain.error.request" as const
}
