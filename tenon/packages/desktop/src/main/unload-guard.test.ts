import { describe, expect, test } from "bun:test"
import { createUnloadGuard } from "./unload-guard"

function guard(answers: boolean[]) {
  const windows = [{ id: "a" }, { id: "b" }]
  const asked: string[] = []
  const unload = createUnloadGuard<(typeof windows)[number]>({
    windows: () => windows,
    ask: (win) => {
      asked.push(win.id)
      return answers.shift() ?? false
    },
  })
  return { windows, asked, unload }
}

describe("createUnloadGuard", () => {
  test("a quit with nothing unsaved asks nobody", () => {
    const { asked, unload } = guard([])
    expect(unload.confirmQuit()).toBe(true)
    expect(asked).toEqual([])
  })

  test("Stay holds the quit and keeps asking; Leave covers every window once", () => {
    const { windows, asked, unload } = guard([false, true])
    unload.setUnsaved(windows[1], true)
    expect(unload.confirmQuit()).toBe(false)
    expect(unload.confirmQuit()).toBe(true)
    expect(unload.confirmQuit()).toBe(true)
    expect(unload.leave(windows[1])).toBe(true)
    expect(asked).toEqual(["b", "b"])
  })

  test("a window saved before the quit is not asked about", () => {
    const { windows, asked, unload } = guard([])
    unload.setUnsaved(windows[0], true)
    unload.setUnsaved(windows[0], false)
    expect(unload.confirmQuit()).toBe(true)
    expect(asked).toEqual([])
  })

  test("a shutdown nobody can answer never prompts, and reset restores asking", () => {
    const { windows, asked, unload } = guard([false])
    unload.setUnsaved(windows[0], true)
    unload.allow()
    expect(unload.leave(windows[0])).toBe(true)
    expect(unload.confirmQuit()).toBe(true)
    unload.reset()
    expect(unload.leave(windows[0])).toBe(false)
    expect(asked).toEqual(["a"])
  })
})
