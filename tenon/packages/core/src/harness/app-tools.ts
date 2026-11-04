export * as HarnessAppTools from "./app-tools"

/**
 * Tenon app tools (notes, timeline, log, calendar, tasks, threads) offered on the `tenon` MCP server.
 * The server installs the provider at startup (`tenon/src/agents/app-tools.ts`); core only lists and
 * routes. The provider decides per caller which tools exist, so a Project thread can get a narrower
 * set than a workspace thread.
 */

/** The folder Command Centre threads run in. They read untrusted mail, so their tools ask before acting. */
export const COMMAND_CENTRE_FOLDER = ".command-centre"

export interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  /** MCP tool annotations; `readOnlyHint: true` marks a tool that changes nothing. */
  readonly annotations?: { readonly readOnlyHint?: boolean }
}

export interface Caller {
  readonly sessionID: string
  /** The assistant message and tool call making the call, when the harness knows them (the in-process loop). */
  readonly messageID?: string
  readonly callID?: string
}

export interface Provider {
  /**
   * Every tool the provider can offer any thread, for the in-process loop, which registers tools when
   * a folder's services start rather than per call. Calls still go through `list(caller)`.
   */
  readonly catalog?: ReadonlyArray<Tool>
  /** The catalog for one folder's in-process loop, when some tools only exist in some folders. */
  readonly catalogFor?: (directory: string) => ReadonlyArray<Tool>
  readonly list: (caller: Caller) => ReadonlyArray<Tool> | Promise<ReadonlyArray<Tool>>
  /** Resolves with the tool's JSON result; a rejection becomes an `isError` result carrying its message. */
  readonly call: (name: string, args: Record<string, unknown>, caller: Caller) => Promise<unknown>
}

const state: { provider?: Provider } = {}

/** Installs the provider; the returned function removes it again if it is still the current one. */
export function install(provider: Provider) {
  state.provider = provider
  return () => {
    if (state.provider === provider) state.provider = undefined
  }
}

export const installed = () => state.provider !== undefined

/** The installed provider's tools for `directory` (its full set without one); empty while nothing is installed. */
export const catalog = (directory?: string): ReadonlyArray<Tool> => {
  const provider = state.provider
  if (!provider) return []
  return (directory !== undefined ? provider.catalogFor?.(directory) : undefined) ?? provider.catalog ?? []
}

/** The tools `caller` may use; empty while nothing is installed or the provider fails. */
export async function list(caller: Caller): Promise<ReadonlyArray<Tool>> {
  const provider = state.provider
  if (!provider) return []
  return Promise.resolve()
    .then(() => provider.list(caller))
    .catch(() => [])
}

/** Runs `name` when it is one of the caller's tools; undefined when it is not an app tool. */
export async function call(name: string, args: Record<string, unknown>, caller: Caller) {
  const provider = state.provider
  if (!provider) return undefined
  if (!(await list(caller)).some((tool) => tool.name === name)) return undefined
  return {
    value: await Promise.resolve().then(() => provider.call(name, args, caller)),
  }
}
