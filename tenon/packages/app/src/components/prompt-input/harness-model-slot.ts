export function harnessModelSlot(input: { models: number; checking: boolean }) {
  if (input.models > 0) return "select"
  return input.checking ? "loading" : "none"
}
