// Sucrase ships no type declarations for its parser entry points, which `unsupported-typescript.ts`
// reads to find TypeScript syntax that its transform drops or emits as CommonJS. Only the members
// used there are declared. The sucrase version is pinned in package.json.

declare module "sucrase/dist/parser" {
  export interface SucraseToken {
    readonly type: number
    readonly contextualKeyword: number
    readonly start: number
    readonly isType: boolean
  }
  export function parse(
    input: string,
    isJSXEnabled: boolean,
    isTypeScriptEnabled: boolean,
    isFlowEnabled: boolean,
  ): { readonly tokens: ReadonlyArray<SucraseToken> }
}

declare module "sucrase/dist/parser/tokenizer/types" {
  export const TokenType: {
    readonly name: number
    readonly string: number
    readonly dot: number
    readonly braceL: number
    readonly braceR: number
    readonly dollarBraceL: number
    readonly eq: number
    readonly _import: number
    readonly _export: number
    readonly _declare: number
  }
}

declare module "sucrase/dist/parser/tokenizer/keywords" {
  export const ContextualKeyword: {
    readonly _global: number
    readonly _module: number
    readonly _namespace: number
    readonly _type: number
  }
}
