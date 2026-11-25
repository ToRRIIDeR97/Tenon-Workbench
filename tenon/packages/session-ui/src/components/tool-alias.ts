const aliases: Record<string, string> = {
  apply_patch: "patch",
  bash: "shell",
  command_execution: "shell",
  acp_execute: "shell",
  acp_edit: "edit",
}

export function toolRendererName(name: string) {
  return aliases[name] ?? name
}
