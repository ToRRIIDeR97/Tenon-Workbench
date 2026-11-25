import { type QueryClient, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { listVaultPages, migrateVault, type VaultPageInfo } from "./client"

const queryRoot = "vault-pages"
type VaultPages = { pages: VaultPageInfo[]; moved: number }

export const invalidateVaultPages = (queryClient: QueryClient, server: string) =>
  queryClient.invalidateQueries({ queryKey: ["second-brain", queryRoot, server] })

export function useVaultPages(directory: Accessor<string | undefined>) {
  const server = useServer()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const key = (target: string | undefined) => ["second-brain", queryRoot, server.key, target ?? ""] as const
  const query = useQuery(() => {
    const target = directory()
    return {
      queryKey: key(target),
      enabled: !!target,
      queryFn: async (): Promise<VaultPages> => {
        const client = { server: serverSDK().server, fetch: platform.fetch, target: { directory: target ?? "" } }
        const moved = await migrateOnce(client, target ?? "")
        return { pages: await listVaultPages(client), moved }
      },
      staleTime: 30_000,
      refetchOnMount: true,
      retry: false,
      networkMode: "always" as const,
    }
  })
  const data = () => (query.isPending || query.isError ? undefined : query.data)
  return {
    pages: () => data()?.pages,
    moved: () => data()?.moved ?? 0,
    clearMoved: () =>
      queryClient.setQueryData<VaultPages>(key(directory()), (current) => current && { ...current, moved: 0 }),
    loading: () => query.isLoading,
    error: () => (query.isError ? (query.error as unknown) : undefined),
    retry: () => void query.refetch(),
    store: (info: VaultPageInfo) =>
      queryClient.setQueryData<VaultPages>(key(directory()), (current) =>
        current ? { ...current, pages: [info, ...current.pages.filter((item) => item.path !== info.path)] } : current,
      ),
    remove: (path: string) =>
      queryClient.setQueryData<VaultPages>(key(directory()), (current) =>
        current ? { ...current, pages: current.pages.filter((item) => item.path !== path) } : current,
      ),
  }
}

const migratedKey = "tenon.notes.migrated:"
const migrated = new Set<string>()
const migrating = new Map<string, Promise<number>>()

export const vaultMigration = (directory: string) => migrating.get(directory)

function migrateOnce(client: Parameters<typeof migrateVault>[0], directory: string) {
  if (migrated.has(directory) || storedFlag(directory)) return Promise.resolve(0)
  const running = migrating.get(directory)
  if (running) return running.then(() => 0)
  const request = migrateVault(client)
    .then((result) => {
      migrated.add(directory)
      try {
        localStorage.setItem(migratedKey + directory, "1")
      } catch {}
      return result.moved
    })
    .catch(() => 0)
    .finally(() => migrating.delete(directory))
  migrating.set(directory, request)
  return request
}

function storedFlag(directory: string) {
  try {
    return localStorage.getItem(migratedKey + directory) === "1"
  } catch {
    return false
  }
}
