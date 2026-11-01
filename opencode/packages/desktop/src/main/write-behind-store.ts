// In-memory view of the renderer's persisted stores. electron-store re-reads and
// re-parses the whole file on every get and atomically rewrites it on every set,
// synchronously on the main process. Renderer state changes (panel drags, tab
// switches) arrive many times per second, so reads are served from memory and
// writes are coalesced into one file write per store per `delay` ms.

type Data = Record<string, unknown>

export type WriteBehindBackend = {
  read(name: string): Data
  write(name: string, data: Data): void
}

export function createWriteBehindStore(backend: WriteBehindBackend, delay = 250) {
  const loaded = new Map<string, Data>()
  const dirty = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function data(name: string) {
    const cached = loaded.get(name)
    if (cached) return cached
    const next = { ...backend.read(name) }
    loaded.set(name, next)
    return next
  }

  function flush(name?: string) {
    const names = name === undefined ? [...dirty] : dirty.has(name) ? [name] : []
    for (const item of names) {
      dirty.delete(item)
      const value = loaded.get(item)
      if (value) backend.write(item, value)
    }
    if (dirty.size === 0 && timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function schedule(name: string) {
    dirty.add(name)
    timer ??= setTimeout(() => {
      timer = undefined
      flush()
    }, delay)
  }

  return {
    get: (name: string, key: string) => data(name)[key],
    keys: (name: string) => Object.keys(data(name)),
    set(name: string, key: string, value: unknown) {
      data(name)[key] = value
      schedule(name)
    },
    // Deletes and clears reach disk immediately: callers then check whether the
    // file is empty and remove it.
    delete(name: string, key: string) {
      delete data(name)[key]
      dirty.add(name)
      flush(name)
    },
    clear(name: string) {
      loaded.set(name, {})
      dirty.add(name)
      flush(name)
    },
    flush: () => flush(),
    // The file was removed or replaced outside this cache.
    forget(name: string) {
      loaded.delete(name)
      dirty.delete(name)
    },
  }
}
