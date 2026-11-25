export * as HarnessAppTools from "./app-tools"

export const COMMAND_CENTRE_FOLDER = ".command-centre"

export interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations?: { readonly readOnlyHint?: boolean }
  readonly permission?: { readonly action: string; readonly field: string }
}

export interface Caller {
  readonly sessionID: string
  readonly messageID?: string
  readonly callID?: string
}

export interface Provider {
  readonly catalog?: ReadonlyArray<Tool>
  readonly catalogFor?: (directory: string) => ReadonlyArray<Tool>
  readonly list: (caller: Caller) => ReadonlyArray<Tool> | Promise<ReadonlyArray<Tool>>
  readonly call: (name: string, args: Record<string, unknown>, caller: Caller) => Promise<unknown>
  readonly projectFolder?: (caller: Caller, projectId: string) => Promise<ProjectFolder | undefined>
}

export interface ProjectFolder {
  readonly directory: string
  readonly name: string
}

const state: { provider?: Provider } = {}

export function install(provider: Provider) {
  state.provider = provider
  return () => {
    if (state.provider === provider) state.provider = undefined
  }
}

export const installed = () => state.provider !== undefined

export const catalog = (directory?: string): ReadonlyArray<Tool> => {
  const provider = state.provider
  if (!provider) return []
  return (directory !== undefined ? provider.catalogFor?.(directory) : undefined) ?? provider.catalog ?? []
}

export async function list(caller: Caller): Promise<ReadonlyArray<Tool>> {
  const provider = state.provider
  if (!provider) return []
  return Promise.resolve()
    .then(() => provider.list(caller))
    .catch(() => [])
}

export async function projectFolder(caller: Caller, projectId: string): Promise<ProjectFolder | undefined> {
  const resolve = state.provider?.projectFolder
  if (!resolve) return undefined
  return Promise.resolve()
    .then(() => resolve(caller, projectId))
    .catch(() => undefined)
}

export const isCommandCentre = (directory: string) =>
  directory
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) === COMMAND_CENTRE_FOLDER

export async function call(name: string, args: Record<string, unknown>, caller: Caller) {
  const provider = state.provider
  if (!provider) return undefined
  if (!(await list(caller)).some((tool) => tool.name === name)) return undefined
  return {
    value: await Promise.resolve().then(() => provider.call(name, args, caller)),
  }
}
