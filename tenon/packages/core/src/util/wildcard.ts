export * as Wildcard from "./wildcard"

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .split(/(\[\*\]|\[\?\])/)
    .map((part) =>
      part === "[*]"
        ? "\\*"
        : part === "[?]"
          ? "\\?"
          : part
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, "."),
    )
    .join("")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}

export function literal(value: string) {
  return value.replace(/[*?]/g, (char) => `[${char}]`)
}
