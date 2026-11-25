export type ShellFunction = (input: Uint8Array) => Uint8Array

export type ShellExpression =
  | { toString(): string }
  | Array<ShellExpression>
  | string
  | { raw: string }
  | ReadableStream

export interface BunShell {
  (strings: TemplateStringsArray, ...expressions: ShellExpression[]): BunShellPromise

  braces(pattern: string): string[]

  escape(input: string): string

  env(newEnv?: Record<string, string | undefined>): BunShell

  cwd(newCwd?: string): BunShell

  nothrow(): BunShell

  throws(shouldThrow: boolean): BunShell
}

export interface BunShellPromise extends Promise<BunShellOutput> {
  readonly stdin: WritableStream

  cwd(newCwd: string): this

  env(newEnv: Record<string, string> | undefined): this

  quiet(): this

  lines(): AsyncIterable<string>

  text(encoding?: BufferEncoding): Promise<string>

  json(): Promise<any>

  arrayBuffer(): Promise<ArrayBuffer>

  blob(): Promise<Blob>

  nothrow(): this

  throws(shouldThrow: boolean): this
}

export interface BunShellOutput {
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly exitCode: number

  text(encoding?: BufferEncoding): string

  json(): any

  arrayBuffer(): ArrayBuffer

  bytes(): Uint8Array

  blob(): Blob
}

export type BunShellError = Error & BunShellOutput
