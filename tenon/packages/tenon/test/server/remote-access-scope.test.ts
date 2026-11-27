import { describe, expect, test } from "bun:test"
import { HttpApi, HttpApiGroup } from "effect/http-api"
import { RemoteAccess } from "@tenon/core/remote-access"
import { Api } from "@tenon/server/api"
import { TenonHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { RemotePairApi } from "../../src/server/routes/instance/httpapi/groups/remote"

const key = (method: string, route: string) => `${method} ${route}`

function routesOf<Id extends string, Groups extends HttpApiGroup.Constraint>(api: HttpApi.HttpApi<Id, Groups>) {
  const routes: Array<string> = []
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: (input) => void routes.push(key(input.endpoint.method, input.endpoint.path)),
  })
  return routes
}

function registered() {
  return [...new Set([...routesOf(TenonHttpApi), ...routesOf(Api), ...routesOf(RemotePairApi)])]
}

const allowed = new Set(RemoteAccess.allowed.map(([method, route]) => key(method, route)))
const denied = new Set(RemoteAccess.denied.map(([method, route]) => key(method, route)))

describe("companion scope covers every registered route", () => {
  test("each registered route is either allowed or denied, never both", () => {
    const routes = registered()
    expect(routes.length).toBeGreaterThan(250)
    expect(routes.filter((route) => !allowed.has(route) && !denied.has(route))).toEqual([])
    expect(routes.filter((route) => allowed.has(route) && denied.has(route))).toEqual([])
  })

  test("allows answers the same as the lists for each registered route", () => {
    const disagree = registered().filter((route) => {
      const [method, pattern] = route.split(" ")
      const concrete = pattern.replace(/:\w+/g, "id_1").replace("*", "notes/a.md")
      return RemoteAccess.allows({ method, path: concrete }) !== allowed.has(route)
    })
    expect(disagree).toEqual([])
  })

  test("only planned thread sync routes are listed without being registered", () => {
    const routes = new Set(registered())
    const unregistered = [...allowed, ...denied].filter((route) => !routes.has(route))
    expect(unregistered.filter((route) => !route.split(" ")[1].startsWith("/api/thread-sync"))).toEqual([])
  })

  test("device management and pairing-code creation are denied to a device", () => {
    expect(denied.has("POST /api/remote/pairing-code")).toBe(true)
    expect(denied.has("GET /api/remote/devices")).toBe(true)
    expect(denied.has("DELETE /api/remote/devices/:id")).toBe(true)
    expect(allowed.has("POST /api/remote/stream-ticket")).toBe(true)
  })
})
