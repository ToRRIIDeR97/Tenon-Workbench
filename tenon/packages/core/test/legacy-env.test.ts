import { expect, test } from "bun:test"
import { LegacyEnv } from "@tenon/core/legacy-env"

test("copies OPENCODE_* variables to unset TENON_* names", () => {
  const env = LegacyEnv.apply({
    OPENCODE_CONFIG_DIR: "/old",
    OPENCODE_DB: "/old.db",
    TENON_DB: "/new.db",
    PATH: "/bin",
  })
  expect(env.TENON_CONFIG_DIR).toBe("/old")
  expect(env.TENON_DB).toBe("/new.db")
  expect(env.OPENCODE_CONFIG_DIR).toBe("/old")
  expect(env.TENON_PATH).toBeUndefined()
})
