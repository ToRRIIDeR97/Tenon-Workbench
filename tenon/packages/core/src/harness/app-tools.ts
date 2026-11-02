export * as HarnessAppTools from "./app-tools"

/**
 * Tenon app tools (notes, timeline, log, calendar, tasks, threads) offered on the `tenon` MCP server.
 * The server installs the provider at startup (`tenon/src/agents/app-tools.ts`); core only lists and
 * routes. The provider decides per caller which tools exist, so a Project thread can get a narrower
 * set than a workspace thread.
 */

export interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface Caller {
  readonly sessionID: string
}

export interface Provider {
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
