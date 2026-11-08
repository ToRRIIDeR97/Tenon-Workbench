/// <reference path="./sucrase-parser.d.ts" />
import { parse, type SucraseToken } from "sucrase/dist/parser"
import { ContextualKeyword } from "sucrase/dist/parser/tokenizer/keywords"
import { TokenType } from "sucrase/dist/parser/tokenizer/types"

export interface UnsupportedTypeScript {
  /** Offset of the offending keyword in the parsed source. */
  readonly start: number
  readonly reason: string
}

const NAMESPACE = "TypeScript namespaces are not supported in code mode; use a plain object instead."
const IMPORT_EQUALS =
  "`import ... =` declarations are not supported in code mode; there are no modules, so use `tools` or a const instead."
const EXPORT_EQUALS = "`export =` is not supported in code mode; use `return` to produce the result."

const isName = (token: SucraseToken | undefined, keyword?: number): boolean =>
  token?.type === TokenType.name && (keyword === undefined || token.contextualKeyword === keyword)

// Index of the `}` closing the block of `declare namespace|module|global ...`, or `index` when the
// declaration has no block (`declare module "x"`).
const skipDeclareBlock = (tokens: ReadonlyArray<SucraseToken>, index: number): number => {
  let open = index + 1
  while (open < tokens.length && tokens[open].type !== TokenType.braceL) {
    const type = tokens[open].type
    if (type !== TokenType.name && type !== TokenType.string && type !== TokenType.dot) return index
    open++
  }
  let depth = 0
  for (let at = open; at < tokens.length; at++) {
    const type = tokens[at].type
    if (type === TokenType.braceL || type === TokenType.dollarBraceL) depth++
    else if (type === TokenType.braceR && --depth === 0) return at
  }
  return tokens.length
}

/**
 * Finds TypeScript syntax that Sucrase accepts but does not turn into code the interpreter can run:
 * namespaces holding values (Sucrase removes them as if they were types), `import x = ...` and
 * `export =` (emitted as CommonJS). Ambient `declare namespace|module|global` blocks are types and pass.
 */
export const findUnsupportedTypeScript = (source: string): UnsupportedTypeScript | undefined => {
  if (!/\b(?:namespace|module|import|export)\b/.test(source)) return undefined
  const { tokens } = parse(source, false, true, false)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const next = tokens[index + 1]
    if (
      token.type === TokenType._declare &&
      (isName(next, ContextualKeyword._namespace) ||
        isName(next, ContextualKeyword._module) ||
        isName(next, ContextualKeyword._global))
    ) {
      index = skipDeclareBlock(tokens, index + 1)
      continue
    }
    if (
      token.isType &&
      (isName(token, ContextualKeyword._namespace) || isName(token, ContextualKeyword._module)) &&
      isName(next) &&
      next.isType
    ) {
      return { start: token.start, reason: NAMESPACE }
    }
    if (token.type === TokenType._import && !token.isType) {
      // `import x = ...` or `import type x = ...`
      const binding = isName(next, ContextualKeyword._type) && isName(tokens[index + 2]) ? index + 2 : index + 1
      if (isName(tokens[binding]) && tokens[binding + 1]?.type === TokenType.eq) {
        return { start: token.start, reason: IMPORT_EQUALS }
      }
    }
    if (token.type === TokenType._export && !token.isType && next?.type === TokenType.eq) {
      return { start: token.start, reason: EXPORT_EQUALS }
    }
  }
  return undefined
}
