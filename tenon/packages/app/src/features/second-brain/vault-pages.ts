import { type QueryClient, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { listVaultPages, migrateVault, type VaultPageInfo } from "./client"

const queryRoot = "vault-pages"
type VaultPages = { pages: VaultPageInfo[]; moved: number }

// Call after a vault write outside `useVaultPages().store`, so the next visit doesn't paint the old list.
export const invalidateVaultPages = (queryClient: QueryClient, server: string) =>
  queryClient.invalidateQueries({ queryKey: ["second-brain", queryRoot, server] })

/**
 * The vault's page list for a workspace, shared by Projects and Project Overview. A revisit paints from the
 * cache and refreshes in the background once it is 30 seconds old; the first read moves pre-vault notes in.
 */
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
      // The server is usually local, so a lost connection is no reason to pause.
      networkMode: "always" as const,
    }
  })
  // Reading `data` while the query is pending suspends, so check the status first.
  const data = () => (query.isPending || query.isError ? undefined : query.data)
  return {
    pages: () => data()?.pages,
    /** Notes the latest read moved into the vault, until `clearMoved`. */
    moved: () => data()?.moved ?? 0,
    clearMoved: () =>
      queryClient.setQueryData<VaultPages>(key(directory()), (current) => current && { ...current, moved: 0 }),
    loading: () => query.isLoading,
    error: () => (query.isError ? (query.error as unknown) : undefined),
    retry: () => void query.refetch(),
    /** Put a saved page at the top of the list. */
    store: (info: VaultPageInfo) =>
      queryClient.setQueryData<VaultPages>(key(directory()), (current) =>
        current ? { ...current, pages: [info, ...current.pages.filter((item) => item.path !== info.path)] } : current,
      ),
  }
}

const migratedKey = "tenon.notes.migrated:"
const migrated = new Set<string>()
/** The migration request in flight per workspace, so other vault reads can wait for it. */
const migrating = new Map<string, Promise<number>>()

/** Resolves once a running migration of this workspace has finished. */
export const vaultMigration = (directory: string) => migrating.get(directory)

/**
 * Ask the server once per workspace to move pre-vault notes in (it backs them up and a repeat moves nothing).
 * A failed call is retried on the next visit; the page list then reports any lasting failure. The server also
 * moves them on its first vault request, so this call mainly reports how many moved.
 */
function migrateOnce(client: Parameters<typeof migrateVault>[0], directory: string) {
  if (migrated.has(directory) || storedFlag(directory)) return Promise.resolve(0)
  const running = migrating.get(directory)
  if (running) return running.then(() => 0)
  const request = migrateVault(client)
    .then((result) => {
      migrated.add(directory)
      try {
        localStorage.setItem(migratedKey + directory, "1")
      } catch {
        // Blocked storage only costs one repeat request next launch, which moves nothing.
      }
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
