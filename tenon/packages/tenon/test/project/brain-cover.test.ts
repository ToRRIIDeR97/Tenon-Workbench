import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { FileMutation } from "@tenon/core/file-mutation"
import { FSUtil } from "@tenon/core/fs-util"
import { Location } from "@tenon/core/location"
import { LocationMutation } from "@tenon/core/location-mutation"
import { ProjectV2 } from "@tenon/core/project"
import { AbsolutePath } from "@tenon/core/schema"
import { tmpdir } from "../fixture/fixture"
import { BrainProject } from "../../src/project/brain"

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])
const dataUrl = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`

const run = <A, E>(
  directory: string,
  effect: Effect.Effect<A, E, Location.Service | LocationMutation.Service | FSUtil.Service | FileMutation.Service>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LocationMutation.locationLayer),
      Effect.provideService(Location.Service, {
        directory: AbsolutePath.make(directory),
        project: { id: ProjectV2.ID.global, directory: AbsolutePath.make(directory) },
      }),
      Effect.provide(LayerNode.compile(FSUtil.node)),
      Effect.provide(LayerNode.compile(FileMutation.node)),
    ),
  )

describe("BrainProject cover image", () => {
  test("parseCover accepts real PNG, JPEG, GIF and WebP bytes and nothing else", () => {
    expect(BrainProject.parseCover(dataUrl("image/png", png)).extension).toBe("png")
    expect(BrainProject.parseCover(dataUrl("image/jpeg", jpeg)).extension).toBe("jpg")
    expect(() => BrainProject.parseCover(dataUrl("image/png", jpeg))).toThrow(BrainProject.InvalidError)
    expect(() => BrainProject.parseCover(dataUrl("image/svg+xml", png))).toThrow(BrainProject.InvalidError)
    expect(() => BrainProject.parseCover("https://example.com/cover.png")).toThrow(BrainProject.InvalidError)
  })

  test("a saved cover sits beside the card, round-trips as a data URL, and is replaced and removed cleanly", async () => {
    await using tmp = await tmpdir()
    const project = await run(tmp.path, BrainProject.create({ name: "Acme", outcome: "Ship it" }))
    expect(await run(tmp.path, BrainProject.readCover(project.id))).toEqual({ dataUrl: null })

    const saved = await run(tmp.path, BrainProject.writeCover(project.id, { dataUrl: dataUrl("image/png", png) }))
    const folder = path.join(tmp.path, project.folder)
    expect(saved.cover).toBe("cover.png")
    expect(new Uint8Array(readFileSync(path.join(folder, "cover.png")))).toEqual(png)
    expect(readFileSync(path.join(folder, "project.md"), "utf8")).toContain("cover: cover.png")
    expect(await run(tmp.path, BrainProject.readCover(project.id))).toEqual({ dataUrl: dataUrl("image/png", png) })

    const replaced = await run(tmp.path, BrainProject.writeCover(project.id, { dataUrl: dataUrl("image/jpeg", jpeg) }))
    expect(replaced.cover).toBe("cover.jpg")
    expect(existsSync(path.join(folder, "cover.png"))).toBe(false)

    const removed = await run(tmp.path, BrainProject.removeCover(project.id))
    expect(removed.cover).toBeUndefined()
    expect(existsSync(path.join(folder, "cover.jpg"))).toBe(false)
    expect(await run(tmp.path, BrainProject.readCover(project.id))).toEqual({ dataUrl: null })
  })

  test("a card naming any other file as its cover reads as having no cover", () => {
    const card = BrainProject.encode(
      {
        id: "project_01J0000000000000000000000",
        folder: ".tenon/projects/project_01J0000000000000000000000",
        name: "Acme",
        outcome: "Ship it",
        instructions: "",
        status: "active",
        progressPercent: 0,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {},
      "",
    )
    const edited = card.replace("title: Acme", "title: Acme\ncover: ../../secrets.png")
    expect(edited).toContain("cover: ../../secrets.png")
    expect(
      BrainProject.decode(edited, ".tenon/projects/project_01J0000000000000000000000/project.md").info.cover,
    ).toBeUndefined()
  })
})
