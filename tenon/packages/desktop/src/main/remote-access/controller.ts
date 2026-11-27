import type { RemoteAccessStatus } from "@tenon/app"
import { DEFAULT_PORT, lanAddresses, validateRemoteConfig, type InterfaceEntry, type RemoteConfig } from "./addresses"
import { startRemoteListener, type RemoteListener } from "./listener"

type Listen = (input: { host: string; port: number; target: () => string }) => Promise<RemoteListener>

export function createRemoteAccess(input: {
  store: { get(key: string): unknown; set(key: string, value: unknown): void }
  interfaces: () => Record<string, ReadonlyArray<InterfaceEntry> | undefined>
  target?: () => string
  listen?: Listen
}) {
  const listen = input.listen ?? startRemoteListener
  const state = {
    listener: undefined as RemoteListener | undefined,
    error: null as string | null,
    target: input.target ?? (() => ""),
  }

  const saved = (): RemoteConfig => {
    const value = input.store.get("config")
    if (!value || typeof value !== "object") return { enabled: false, address: "", port: DEFAULT_PORT }
    const config = value as Partial<RemoteConfig>
    return {
      enabled: config.enabled === true,
      address: typeof config.address === "string" ? config.address : "",
      port: typeof config.port === "number" ? config.port : DEFAULT_PORT,
    }
  }

  const close = async () => {
    const listener = state.listener
    state.listener = undefined
    await listener?.stop()
  }

  const apply = async (config: RemoteConfig) => {
    await close()
    state.error = null
    if (!config.enabled) return
    if (!lanAddresses(input.interfaces()).some((item) => item.address === config.address)) {
      state.error = "remote_address_gone"
      return
    }
    state.listener = await listen({ host: config.address, port: config.port, target: () => state.target() }).catch(
      (error: unknown) => {
        state.error = errorCode(error)
        return undefined
      },
    )
  }

  const status = async (): Promise<RemoteAccessStatus> => {
    const config = saved()
    return {
      ...config,
      addresses: lanAddresses(input.interfaces()),
      running: Boolean(state.listener),
      url: state.listener?.url ?? null,
      error: state.error,
    }
  }

  return {
    setTarget(target: () => string) {
      state.target = target
    },
    async start() {
      await apply(saved())
    },
    status,
    async configure(change: RemoteConfig) {
      const config = validateRemoteConfig(change, lanAddresses(input.interfaces()))
      input.store.set("config", config)
      await apply(config)
      return status()
    },
    stop: close,
  }
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code
  return error instanceof Error ? error.message : "remote_listen_failed"
}
