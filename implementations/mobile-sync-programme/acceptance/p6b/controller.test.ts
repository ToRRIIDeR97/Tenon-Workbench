import { describe, expect, test } from "bun:test"
import { createRemoteAccess } from "./controller"

function harness(options: { fail?: string } = {}) {
  const data = new Map<string, unknown>()
  const started: Array<{ host: string; port: number }> = []
  let stopped = 0
  const remote = createRemoteAccess({
    store: { get: (key) => data.get(key), set: (key, value) => void data.set(key, value) },
    interfaces: () => ({
      "Wi-Fi": [{ address: "192.168.1.20", family: "IPv4", internal: false }],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    }),
    listen: async (input) => {
      if (options.fail) throw Object.assign(new Error(options.fail), { code: options.fail })
      started.push({ host: input.host, port: input.port })
      return {
        url: `http://${input.host}:${input.port}`,
        stop: async () => {
          stopped++
        },
      }
    },
  })
  return { remote, data, started, stopped: () => stopped }
}

describe("AC-P6b-1 off by default", () => {
  test("nothing listens until the owner turns it on", async () => {
    const { remote, started } = harness()
    await remote.start()
    const status = await remote.status()
    expect(status.enabled).toBe(false)
    expect(status.running).toBe(false)
    expect(status.url).toBeNull()
    expect(status.addresses).toEqual([{ address: "192.168.1.20", name: "Wi-Fi" }])
    expect(started).toEqual([])
  })

  test("turning it on binds the chosen address, saves the choice, and a restart reuses it", async () => {
    const first = harness()
    const on = await first.remote.configure({ enabled: true, address: "192.168.1.20", port: 47100 })
    expect(on.running).toBe(true)
    expect(on.url).toBe("http://192.168.1.20:47100")
    expect(first.started).toEqual([{ host: "192.168.1.20", port: 47100 }])
    expect(first.data.get("config")).toEqual({ enabled: true, address: "192.168.1.20", port: 47100 })
    const off = await first.remote.configure({ enabled: false, address: "192.168.1.20", port: 47100 })
    expect(off.running).toBe(false)
    expect(first.stopped()).toBe(1)
  })

  test("a refused choice saves nothing, and a bind failure is reported", async () => {
    const { remote, data } = harness()
    await expect(remote.configure({ enabled: true, address: "10.9.9.9", port: 47100 })).rejects.toThrow(
      "remote_address_invalid",
    )
    expect(data.has("config")).toBe(false)
    const busy = harness({ fail: "EADDRINUSE" })
    const status = await busy.remote.configure({ enabled: true, address: "192.168.1.20", port: 47100 })
    expect(status.running).toBe(false)
    expect(status.error).toBe("EADDRINUSE")
  })

  test("a saved address that is gone is not bound at start", async () => {
    const { remote, data, started } = harness()
    data.set("config", { enabled: true, address: "172.16.0.5", port: 47100 })
    await remote.start()
    const status = await remote.status()
    expect(started).toEqual([])
    expect(status.running).toBe(false)
    expect(status.error).toBe("remote_address_gone")
  })
})
