import { SecondBrainRequestError } from "@/features/second-brain/client"

type LinkErrorKey =
  | "secondBrain.sidebar.addProject.error.invalidFolder"
  | "secondBrain.sidebar.addProject.error.overlapsWorkspace"
  | "secondBrain.sidebar.addProject.error.protectedFolder"

const linkReasons = new Map<string, LinkErrorKey>([
  ["invalid_folder", "secondBrain.sidebar.addProject.error.invalidFolder"],
  ["overlaps_workspace", "secondBrain.sidebar.addProject.error.overlapsWorkspace"],
  ["protected_folder", "secondBrain.sidebar.addProject.error.protectedFolder"],
])

export function linkFolderErrorKey(cause: unknown) {
  const reason = cause instanceof SecondBrainRequestError ? cause.reason : undefined
  return (reason ? linkReasons.get(reason) : undefined) ?? "common.requestFailed"
}
