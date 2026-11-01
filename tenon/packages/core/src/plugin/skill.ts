/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeTenonContent from "./skill/customize-tenon.md" with { type: "text" }

export const CustomizeTenonContent = customizeTenonContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-tenon",
            description:
              "Use ONLY when the user is editing or creating Tenon's own configuration: tenon.json, tenon.jsonc (or the older opencode.json), files under .tenon/ or .opencode/, or files under ~/.config/tenon-workbench/. Also use when creating or fixing opencode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
            location: AbsolutePath.make("/builtin/customize-tenon.md"),
            content: CustomizeTenonContent,
          }),
        }),
      )
    })
  }),
})
