import { beforeAll, describe, expect, mock, test } from "bun:test"

let listedTerminals: typeof import("./terminal").listedTerminals

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  mock.module("@tenon/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  listedTerminals = (await import("./terminal")).listedTerminals
})

describe("listedTerminals", () => {
  test("keeps the terminals of a list answer", () => {
    const terminal = { id: "pty_1", title: "Dev server", status: "running", sessionID: "ses_a" }
    expect(listedTerminals([terminal])).toEqual([terminal])
  })

  test("reads an answer that is not a list as no terminals", () => {
    expect(listedTerminals({})).toEqual([])
    expect(listedTerminals(undefined)).toEqual([])
    expect(listedTerminals(null)).toEqual([])
    expect(listedTerminals("pty_1")).toEqual([])
  })

  test("drops entries that are not terminals", () => {
    const terminal = { id: "pty_2", title: "Terminal 2" }
    expect(listedTerminals([null, 3, { id: 4, title: "Bad" }, { id: "pty_3" }, terminal])).toEqual([terminal])
  })
})
