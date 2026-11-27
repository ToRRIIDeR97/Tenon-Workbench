import { Capacitor, registerPlugin } from "@capacitor/core"

type SecureStorePlugin = {
  get(input: { key: string }): Promise<{ value: string | null }>
  set(input: { key: string; value: string }): Promise<void>
  remove(input: { key: string }): Promise<void>
}

const native = registerPlugin<SecureStorePlugin>("SecureStore")

export function secureStore() {
  if (!Capacitor.isNativePlatform()) return browserStore()
  return {
    get: async (key: string) => (await native.get({ key })).value,
    set: (key: string, value: string) => native.set({ key, value }),
    remove: (key: string) => native.remove({ key }),
  }
}

function browserStore() {
  return {
    get: async (key: string) => sessionStorage.getItem(key),
    set: async (key: string, value: string) => sessionStorage.setItem(key, value),
    remove: async (key: string) => sessionStorage.removeItem(key),
  }
}
