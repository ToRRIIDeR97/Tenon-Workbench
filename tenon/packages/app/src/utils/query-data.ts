import type { QueryKey } from "@tanstack/solid-query"

export function cachedQueryData<T>(
  cache: { getQueryData: <Data>(key: QueryKey) => Data | undefined },
  query: { readonly dataUpdatedAt: number },
  key: QueryKey,
) {
  if (query.dataUpdatedAt === 0) return undefined
  return cache.getQueryData<T>(key)
}
