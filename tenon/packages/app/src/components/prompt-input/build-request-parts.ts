import { getFilename } from "@tenon/core/util/path"
import { type AgentPartInput, type FilePartInput, type Part, type TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { FileSelection } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import { Identifier } from "@/utils/id"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"
import { createQuoteMetadata, formatQuoteNote } from "@tenon/session-ui/quote-note"
import { SKILL_REFERENCE_MIME, promptSkills, skillInstruction } from "@/utils/skill-reference"

/** Marks a synthetic text part that carries a skill chip's instructions. */
const SKILL_PART_KEY = "tenonSkill"

type PromptRequestPart = (TextPartInput | FilePartInput | AgentPartInput) & { id: string }

type ContextQuote = {
  key: string
  type: "quote"
  text: string
  messageID?: string
}

type ContextFile = {
  key: string
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

type BuildRequestPartsInput = {
  prompt: Prompt
  context: (ContextFile | ContextQuote)[]
  images: (Omit<ImageAttachmentPart, "blob"> & { dataUrl: string })[]
  text: string
  messageID: string
  sessionID: string
  sessionDirectory: string
  /** A Tenon skill's instructions by name; undefined for a skill the harness loads itself. */
  skill?: (name: string) => string | undefined
}

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

// Skill chips are file mentions too, but they go out as instructions, never as files.
const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart =>
  part.type === "file" && part.mime !== SKILL_REFERENCE_MIME
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"

const toOptimisticPart = (part: PromptRequestPart, sessionID: string, messageID: string): Part => {
  if (part.type === "text") {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      synthetic: part.synthetic,
      ignored: part.ignored,
      time: part.time,
      metadata: part.metadata,
      sessionID,
      messageID,
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      mime: part.mime,
      filename: part.filename,
      url: part.url,
      source: part.source,
      sessionID,
      messageID,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.source,
    sessionID,
    messageID,
  }
}

export function buildRequestParts(input: BuildRequestPartsInput) {
  const requestParts: PromptRequestPart[] = input.text.trim()
    ? [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: input.text,
        },
      ]
    : []

  const skills = promptSkills(input.prompt).map(
    (name) =>
      ({
        id: Identifier.ascending("part"),
        type: "text",
        text: skillInstruction(name, input.skill?.(name)),
        synthetic: true,
        metadata: { [SKILL_PART_KEY]: name },
      }) satisfies PromptRequestPart,
  )

  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    const source = attachment.source
      ? {
          ...attachment.source,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
        }
      : {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path,
        }
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime ?? "text/plain",
      url: attachment.url ?? `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      filename: attachment.filename ?? getFilename(attachment.path),
      source,
    } satisfies PromptRequestPart
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "agent",
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    } satisfies PromptRequestPart
  })

  const used = new Set(files.map((part) => part.url))
  const context = input.context.flatMap((item): PromptRequestPart[] => {
    if (item.type === "quote")
      return [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatQuoteNote(item.text),
          synthetic: true,
          metadata: createQuoteMetadata(item.text),
        } satisfies PromptRequestPart,
      ]
    const path = absolute(input.sessionDirectory, item.path)
    const url = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    if (!comment && used.has(url)) return []
    used.add(url)

    const filePart = {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url,
      filename: getFilename(item.path),
    } satisfies PromptRequestPart

    if (!comment) return [filePart]

    const mentions = parseCommentMentions(comment).flatMap((path) => {
      const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
      if (used.has(url)) return []
      used.add(url)
      return [
        {
          id: Identifier.ascending("part"),
          type: "file",
          mime: "text/plain",
          url,
          filename: getFilename(path),
        } satisfies PromptRequestPart,
      ]
    })

    return [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text: formatCommentNote({ path: item.path, selection: item.selection, comment }),
        synthetic: true,
        metadata: createCommentMetadata({
          path: item.path,
          selection: item.selection,
          comment,
          preview: item.preview,
          origin: item.commentOrigin,
        }),
      } satisfies PromptRequestPart,
      filePart,
      ...mentions,
    ]
  })

  const images = input.images.map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.sourcePath ?? attachment.filename,
    } satisfies PromptRequestPart
  })

  requestParts.push(...skills, ...files, ...context, ...agents, ...images)

  return {
    requestParts,
    optimisticParts: requestParts.map((part) => toOptimisticPart(part, input.sessionID, input.messageID)),
  }
}

type HarnessFile = { uri: string; name?: string; mention?: { start: number; end: number; text: string } }

const skillPartName = (part: PromptRequestPart) => {
  if (part.type !== "text" || !part.synthetic) return
  const name = part.metadata?.[SKILL_PART_KEY]
  return typeof name === "string" ? name : undefined
}

/**
 * The prompt for the v2 and harness route, which has no hidden parts: the text is what the user wrote (plus quote
 * and comment notes, as before), and each skill's instructions go as a `data:text/plain` attachment. Every harness
 * and the built-in loop read such an attachment inline, so the skill still applies while the thread shows a chip
 * instead of the skill's whole body.
 */
export function harnessPromptInput(requestParts: ReadonlyArray<PromptRequestPart>) {
  return {
    text: requestParts
      .flatMap((part) => (part.type === "text" && skillPartName(part) === undefined ? [part.text] : []))
      .join("\n"),
    files: requestParts.flatMap((part): HarnessFile[] => {
      const skill = skillPartName(part)
      if (skill !== undefined && part.type === "text")
        return [{ uri: `data:text/plain;charset=utf-8,${encodeURIComponent(part.text)}`, name: `${skill} skill` }]
      if (part.type !== "file") return []
      const text = part.source?.text
      return [
        {
          uri: part.url,
          name: part.filename,
          mention: text ? { start: text.start, end: text.end, text: text.value } : undefined,
        },
      ]
    }),
    agents: requestParts.flatMap((part) =>
      part.type === "agent"
        ? [
            {
              name: part.name,
              mention: part.source
                ? { start: part.source.start, end: part.source.end, text: part.source.value }
                : undefined,
            },
          ]
        : [],
    ),
  }
}
