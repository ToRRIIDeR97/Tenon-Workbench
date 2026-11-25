import fs from "node:fs"
import os from "node:os"

const TMP = os.tmpdir()
const REAL_TMP = fs.realpathSync(TMP)

export function stripCrlf(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

export function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/")
}

export function withTmpdirStripped(text: string, marker = "<TMPDIR>"): string {
  return text.replaceAll(REAL_TMP, marker).replaceAll(TMP, marker)
}

export const PATH_SEP = "[/\\\\]"

export function normalizeForSnapshot(
  text: string,
  options?: {
    readonly tmpdirMarker?: string
    readonly pathReplacements?: ReadonlyArray<readonly [RegExp, string]>
  },
): string {
  let out = stripCrlf(text)
  out = withTmpdirStripped(out, options?.tmpdirMarker)
  for (const [pattern, replacement] of options?.pathReplacements ?? []) {
    out = out.replace(pattern, replacement)
  }
  return out
}
